package controllers

import play.api._
import play.api.mvc._
import play.api.Play.current
import play.twirl.api._
import actors._
import play.api.libs.json.JsValue

object Application extends Controller {

  def index = Action { implicit request =>
    Ok(views.html.index("Your new application is ready."))
  }

  def main = Action { implicit request =>
    Ok(views.html.main("Simple game")(Html("<div>Text</div>")))
  }

  def socket = WebSocket.acceptWithActor[JsValue, JsValue] { request => out =>
    PlayerActor.props(out)
  }

}