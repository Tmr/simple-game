package actors

/**
 * Created by Tmt on 15.08.14.
 */

import akka.actor._
import play.api.libs.json._
import play.api.mvc.WebSocket.FrameFormatter

object PlayerMessages {

  case class Pos(x: Int, y: Int)
  object Pos { implicit val posFormat = Json.format[Pos] }

  case class Size(width: Int, height: Int)
  object Size { implicit val format = Json.format[Size] }

  case class PlayerData(id:String, var p: Pos, a: Int)
  object PlayerData { implicit val playerFormat = Json.format[PlayerData] }

  case class Join()
  case class Leave(id: String, c:String = "l")
  object Leave { implicit val format = Json.format[Leave] }

  case class Spawn(playerData: PlayerData, c:String)
  object Spawn { implicit val format = Json.format[Spawn] }

  case class Move(id: String, p: List[Int], a:Int, c: String = "m")
  object Move { implicit val format = Json.format[Move] }

  case class Shoot(id: String, a:Int, c: String = "f")
  object Shoot { implicit val format = Json.format[Shoot] }

  case class Snapshot(players: List[PlayerData], c: String = "s")
  object Snapshot { implicit val snapshotFormat = Json.format[Snapshot] }//; implicit val frameFormatter = FrameFormatter.jsonFrame[Snapshot]

  case class SetId(id: String)
}

object PlayerActor {
  def props(out: ActorRef) = Props(new PlayerActor(out, GameStateActor.ref))
}

class PlayerActor(out: ActorRef, gameStateActor: ActorRef) extends Actor with akka.actor.ActorLogging {
  import PlayerMessages._

  var id: Option[String] = None

  def receive = {
    case json:JsValue => (json \ "c").as[String] match {
      case "join" => {
        //log.info(s"join received by ${context.self}")
        gameStateActor ! Join()
      }
      case "m"  => {
        gameStateActor ! Move(id.getOrElse("unknown-id"), (json \ "p").as[List[Int]], (json \ "a").as[Int])
      }
      case "f" => gameStateActor ! Shoot(id.getOrElse("unknown-id"), (json \ "a").as[Int])
    }
    case s: Spawn => {
      //log.info(s"${s} received by ${context.self}")
      out ! Json.toJson(s)
    }
    case m: Move => {
      //log.info(s"${s} received by ${context.self}")
      out ! Json.toJson(m)
    }
    case s: Shoot => {
      //log.info(s"${s} received by ${context.self}")
      out ! Json.toJson(s)
    }
    case l: Leave => {
      //log.info(s"${s} received by ${context.self}")
      out ! Json.toJson(l)
    }
    case s: Snapshot => {
      //log.info(s"Snapshot received by ${context.self}")
      out ! Json.toJson(s)
    }
    case SetId(newId) => id = Some(newId)
  }
}

class GameStateActor extends Actor with akka.actor.ActorLogging {
  import PlayerMessages._
  import scala.util.Random._

  case class Player(playerData: PlayerData, ref: ActorRef, isDead: Boolean)

  var lastId = 0;
  var players = List[Player]()
  val sceneSize = Size(400, 400)

  def otherPlayers = players.filter(_.ref != context.sender())
  def player(playerRef: ActorRef) = players.find(_.ref == playerRef)

  def broadcastExceptSender(msg: Any) = {
    otherPlayers.foreach(_.ref ! msg)
  }

  def receive = {
    case Join() => {
      context.watch(context.sender())
      lastId = (lastId + 1) % 10000000;
      val playerId = "p" + lastId
      val newPlayer = Player(PlayerData(playerId, Pos(nextInt(sceneSize.width), nextInt(sceneSize.height)), 0), context.sender(), false)
      context.sender() ! SetId(playerId)
      context.sender() ! Spawn(newPlayer.playerData, "bl") // spawn local
      broadcastExceptSender(Spawn(newPlayer.playerData, "b"))
      players = newPlayer :: players
      context.sender() ! Snapshot(otherPlayers.map(_.playerData))
    }
    case m:Move => {
      player(context.sender()).foreach(p =>{
        p.playerData.p = Pos(m.p.head, m.p.last)
        broadcastExceptSender(m)
      })

    }
    case s:Shoot => broadcastExceptSender(s)
    case Terminated(playerRef) => {
      player(playerRef).foreach(leavingPlayer => {
        log.info(s"Player ${leavingPlayer.playerData.id} is leaving")
        players = players.filterNot(_ == leavingPlayer)
        broadcastExceptSender(Leave(leavingPlayer.playerData.id))
      })
    }
    case a: Any => log.debug(s"recieved unknown command: ${a}")
  }
}

object GameStateActor {
  val actorSystem = ActorSystem("simple-game")
  val ref = actorSystem.actorOf(Props[GameStateActor], "game-state")
}