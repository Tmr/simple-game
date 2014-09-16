// Date.now shim
if (!Date.now) {
    Date.now = function() { return new Date().getTime(); };
}

function filterCmdBy(c) {
    return function(cmd) { return cmd.c == c }
}

window.Game = {};

var PlayerController = function (canvasOffset, ticks){

  // always :: a -> (b -> a)
  function always(value) { return function(_) { return value } }

  function makeDirectionsStream() {
      // allKeyUps :: Observable KeyEvent
      var allKeyUps = $(document).asEventStream("keyup")
      var allKeyDowns = $(document).asEventStream("keydown")

      // keyCodeIs :: Int -> (KeyEvent -> Bool)
      function keyCodeIs(keyCode) { return function(event) { return event.keyCode == keyCode} }
      // keyUps :: Int -> Observable KeyEvent
      function keyUps(keyCode) { return allKeyUps.filter(keyCodeIs(keyCode)) }
      function keyDowns(keyCode) { return allKeyDowns.filter(keyCodeIs(keyCode)) }

      // keyState :: Int -> a -> Observable [a]
      function keyState(keyCode, value) {
        return keyDowns(keyCode).map(always([value])).
          merge(keyUps(keyCode).map(always([]))).toProperty([])
      }

      // concat :: [a] -> [a] -> [a]
      function concat(a1, a2) {
        return a1.concat(a2)
      }

      var startPos = new paper.Point(50, 50)

      function head(array) { return array[0] }
      function id(x) { return x }
      function latter(a, b) { return b }

      // direction, movements, position :: Observable Point
      var direction = keyState(38, new paper.Point(0, -1))
        .combine(keyState(40, new paper.Point(0, 1)), concat)
        .combine(keyState(37, new paper.Point(-1, 0)), concat)
        .combine(keyState(39, new paper.Point(1, 0)), concat)
        .map(head)

      return direction.sampledBy(ticks).filter(id);

  }

  function makeMousePositionsStream() {
    return $(document).asEventStream("mousemove").map(function (event) {
        return new paper.Point(event.clientX - canvasOffset.left, event.clientY - canvasOffset.top);
    });
  }

  function makeFireStream() {
    var mouseDowns = $(document).asEventStream("mousedown").filter(function(event){return event.button == 0}).map(always(true))
    var mouseUps = $(document).asEventStream("mouseup").filter(function(event){return event.button == 0}).map(always(false))
    return mouseDowns.merge(mouseUps).toProperty(false)
  }

  this.directions = makeDirectionsStream();
  this.mousePositions = makeMousePositionsStream();
  this.fire = makeFireStream();
}

var Projectile = function(initialPosition, velocityNormal, projectilesStream, playerId) {
    function drawElement() {
        var lineLength = 50;
        var line = new paper.Path({
            segments: [initialPosition, new paper.Point(initialPosition.add(velocityNormal.multiply(lineLength)))],
            strokeColor: 'black'
        })
        line.transformContent = false
        return line
    }

    var element = drawElement()
    var speed = 50
    var maxLength = 500
    this.position = Game.ticks.map(function(timeDelta){return velocityNormal.multiply(timeDelta * 0.001 * speed)}).scan(
        {pos: initialPosition, len: 0},
        function(acc, velo) {
            return {pos: acc.pos.add(velo), len: acc.len + velo.length}
        }
    )
    var unsubscribe = this.position.onValue(function(v) {
        element.position = v.pos
        projectilesStream.push(element.position)

        if( Game.localPlayer.id != playerId && Game.localPlayer.isCollide(element) )
          Game.localPlayer.hit()

        if (v.len > maxLength) {
            unsubscribe()
            element.remove()
        }
    });
}

Game.drawPlayer = function (initialPosition, id, circleColor, captionColor) {
    var hp = 100
    var radius = 20
    var circle = new paper.Path.Circle({
       center: initialPosition,
       radius: radius,
       fillColor: circleColor
    });

    var line = new paper.Path({
        segments: [initialPosition, new paper.Point(initialPosition.x + radius, initialPosition.y)],
        strokeColor: 'black'
    });

    var text = new paper.PointText({
        point: [initialPosition.x, initialPosition.y - radius - 5],
        content: id +', ' + hp,
        fillColor: captionColor,
        fontSize: 8
    });

    var playerGroup = new paper.Group([circle, line]);
    var textGroup = new paper.Group([text]);
    var group = new paper.Group([playerGroup, textGroup]);
    playerGroup.transformContent = false;

    group.isCollide = function(otherPath){
      var intersections = circle.getIntersections(otherPath);
      return intersections.length > 0;
    }

    return group;
  }


var RemoteController = function(playerCmdStream) {
    this.movements = playerCmdStream.filter(filterCmdBy("m"))
    this.leave = playerCmdStream.filter(filterCmdBy("l"))
    this.shoot = playerCmdStream.filter(filterCmdBy("f"))
    playerCmdStream.onValue(function(v){console.log('cmd:',v)})
}

var RemotePlayer = function (id, remoteController, initialPosition, initialAngle, projectilesStream) {
    var playerElement = Game.drawPlayer(initialPosition, id, "red", "blue")
    var ticksBetweenCmds = Game.sendCmdRate / Game.tickRate;
    var ticksBetweenCmdsReciprocal = 1 / ticksBetweenCmds;
    var movements = remoteController.movements.flatMapLatest(function(cmd) {
        var endPos = new paper.Point(cmd.p[0], cmd.p[1])
        var move = endPos.subtract(playerElement.position).multiply(ticksBetweenCmdsReciprocal)
        //var angle = (playerElement.children[0].rotation - cmd.a) * ticksBetweenCmdsReciprocal
        var angle = cmd.a
        return Game.ticks.take(ticksBetweenCmds).map(function(){ return {move: move, angle: angle} })
    })
    var positions = movements.scan({pos: initialPosition, angle: initialAngle}, function(acc, delta){
        acc.pos = acc.pos.add(delta.move)
        acc.angle = delta.angle// + acc.angle
        return acc
    })

    var unsubscribePositions = positions.onValue(function(p) {
        playerElement.children[0].rotate(p.angle - playerElement.children[0].rotation)
        playerElement.children[0].position = p.pos
        playerElement.children[1].position = new paper.Point(p.pos.x, p.pos.y - 12);
    })

    function doFire (position, angle) {
        var vn = new paper.Point(0, 1)
        vn.angle = angle
        new Projectile(position, vn, projectilesStream, id)
    }
    var unsubscribeShoot = remoteController.shoot.onValue(function(cmd) { doFire(playerElement.children[0].position, cmd.a)})

    var unsubscribeLeave = remoteController.leave.onValue(function(cmd) { leave() })
    function leave() {
        playerElement.remove()
        unsubscribePositions()
        unsubscribeLeave()
        unsubscribeShoot()
    }
}

var LocalPlayer = function(id, controller, initialPosition, projectilesStream, upStream) {
  this.id = id;

  playerElement = Game.drawPlayer(initialPosition, id, "green", "blue")

  // TODO: modify and return the same accumulator instance, don't create new every time
  var state = Bacon.update(
    {pos: initialPosition, angle: 0},
    [controller.mousePositions, controller.directions], function (prevValue, mousePos, move) {
        var newPos = prevValue.pos.add(move);
        return {pos: newPos, angle: mousePos.subtract(newPos).angle}
    },
    [controller.mousePositions], function (prevValue, mousePos) {
        return {pos: prevValue.pos, angle:  mousePos.subtract(prevValue.pos).angle}
    },
    [controller.directions], function (prevValue, move) {
        return {pos: prevValue.pos.add(move), angle: prevValue.angle}
    }
  )

  var unsubscribeState = state.onValue(function (p) {
    playerElement.children[0].rotate(p.angle - playerElement.children[0].rotation)
    playerElement.children[0].position = p.pos
    playerElement.children[1].position = new paper.Point(p.pos.x, p.pos.y - 12);
  })

  var moveCmdStream = state.sample(Game.sampleRate).map(function(state) {
    return {c:"m", p: [state.pos.x, state.pos.y], a: Math.round(state.angle)}
  }).skipDuplicates(function(a, b) {
    return a.p[0] == b.p[0] && a.p[1] == b.p[1] && a.a == b.a;
  })

  function doFire (position, angle) {
    var vn = new paper.Point(0, 1)
    vn.angle = angle
    new Projectile(position, vn, projectilesStream, id)
  }

  //controller.fire.sample(400).onValue(function(v){console.log(v)})

  var fireStream = controller.fire.filter(function (f) {return f})
  var unsubsribeFire = fireStream.onValue(function () {
    doFire(playerElement.children[0].position, playerElement.children[0].rotation)
  })

  var shootCmdStream = fireStream.map(function(){
    return {c:"f", a: Math.round(playerElement.children[0].rotation)}
  })

  unsubscribeCmdsStream = moveCmdStream.merge(shootCmdStream.changes()).onValue(function (cmd) {
    upStream.push(cmd);
  })

  this.hit = function(){
    playerElement.remove()
    unsubscribeState()
    //unsubscribeFire()
    unsubscribeCmdsStream()
    upStream.push({c:"l"});
  }

  this.isCollide = function(otherPath){
    var isCollide = playerElement.isCollide(otherPath)
    //console.log(isCollide)
    return isCollide
  }

  state.onValue(function (p){ $('#text').text(p.angle + "  " + p.pos) })
  //controller.mousePositions.onValue(function (p){ $('#text').text(p) })
}

Game.makeWebSocketStream = function (url){
    var eventStreams = null;
    if ("WebSocket" in window) {

        var ws = new WebSocket(url);

        var upStream = new Bacon.Bus();
        var disconnectedStream = new Bacon.Bus();
        var disconnectedProperty = disconnectedStream.toProperty(true)
        var unsubscribeInput = upStream.holdWhen(disconnectedProperty).onValue(function(msg){
            //console.log(msg)
            ws.send(JSON.stringify(msg));
        });

        ws.onopen = function(){
            console.log("Connected");
            disconnectedStream.push(false);
        };

        ws.onclose = function(){
            alert("Connection is closed...");
            unsubscribeInput();
        };

        ws.onerror = function(){
            alert("Connection error...");
            unsubscribeInput();
        }

        var onMessageStream = Bacon.fromEventTarget(ws, "message").map(function(event) {
            var dataString = event.data;
            data = JSON.parse(dataString)
            return data;
        });

        eventStreams = {};
        eventStreams.upStream = upStream;
        eventStreams.downStream = onMessageStream;
    } else {
        // The browser doesn't support WebSocket
        alert("WebSocket NOT supported by your Browser!");
    }
    return eventStreams;
}



Game.init = function(url){
  var canvas = document.getElementById('canvas');
  paper.setup(canvas);

  Game.tickRate = 33;
  Game.sendCmdRate = 200;

  var serverStreams = Game.makeWebSocketStream(url);

  Game.ticks = Bacon.interval(Game.tickRate).map(function(){return Date.now()}).diff(0, function(prevTime, newTime) {return newTime - prevTime}).changes();
  Game.ticks.onValue(function(timeDelta){
    paper.view.draw()
    $('#ticks').text(timeDelta)
  });

  var playerController = new PlayerController($(canvas).offset(), Game.ticks);

  Game.projectilesStream = new Bacon.Bus();

  function addLocalPlayer(id, initialPosition) {
    Game.localPlayer = new LocalPlayer(id, playerController, initialPosition, Game.projectilesStream, serverStreams.upStream);
  }

  function setupDownStream() {
      //serverStreams.downStream.onValue(function(v){console.log(v)})
    function setupRemotePlayer(playerData) {
        function isCurrentPlayerFunction(playerData) {
            return function(cmd) { return cmd.id && cmd.id == playerData.id }
        }
        var playerStream = serverStreams.downStream.filter(isCurrentPlayerFunction(playerData))
        var controller = new RemoteController(playerStream)
        return new RemotePlayer(playerData.id, controller, new paper.Point(playerData.p.x, playerData.p.y), playerData.a, Game.projectilesStream)
    }
    var snapshotStream = serverStreams.downStream.filter(filterCmdBy("s"))
    snapshotStream.onValue(function (data) {
        for (var i = 0; data.players.length > i; i++) {
            setupRemotePlayer(data.players[i])
        }
    })

    var localPlayerSpawnStream = serverStreams.downStream.filter(filterCmdBy("bl"));
    localPlayerSpawnStream.onValue(function(cmd) {
        addLocalPlayer(cmd.playerData.id, new paper.Point(cmd.playerData.p.x, cmd.playerData.p.y))
    })

    var playerSpawnStream = serverStreams.downStream.filter(filterCmdBy("b"))
    playerSpawnStream.onValue(function(cmd) { setupRemotePlayer(cmd.playerData) })
  //  var playerLeaveStream = serverStreams.downStream.filter(filterCmdBy("l"))

  }
  setupDownStream()
  serverStreams.upStream.push({c:"join"})
};