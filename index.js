import fs from "fs";
import { cleanJid } from "./cosas/utils.js";
import { profileImageData } from "./cosas/utils.js";
import ytSearch from "yt-search";
import chalk from "chalk";
import { convertAndDownload } from "./cosas/lib/yt-scrap.js"
async function comandos({ socket, data }) {
  // ACCIONES DEL BOT QUE NO NECEISTEN PREFIJOS
  if (message.type === 'stickerMessage') {
    console.log(JSON.stringify(message, null, 2))
  }
  
  // abajo CON profijos
  
  if (!data.usedPrefix) return data.found = true;
  
  switch (data.commandName) {
    /* 
     * ACA TU CREARAS TUS COMANDOS PERSONALIZADOS
     * PARA CREARLOS PRIMEROS DEBERAS INICIAR CON UN CASE Y LUEGO COMILLAS Y LUEGO DOS PUNTOS Y ABRES LLAVEZ
     * PARA CERRAR EL COMANDO USARAS BREAK Y CERRARAS LAS LLAVES, PUEDES USAR MAS COSAS, ACA UN EJEMPLO DE UN COMANDO BASICO:
     case "hola": {
       await data.text("HOLA MUNDO");
       break;
     }
     * Parece dificil pero no lo es
    */
  
    case "ytmp3":
    case "play":
    case "playaudio":
    case "play1":
    case "yta": {
      // Ejemplo de comando, OJO LA API PUEDE DEJAR DE FUNCIONAR
      data.found = true;
      if (!data.q) return data.reply("Manda una URL de un video de YouTube para darte el audio");
      const result = await ytSearch(data.q);
      const first = result.videos[0];
      const { url, title, thumbnail, timestamp, ago, views } = first;
      const texto = `♡ *Bot Download* ♡\n🔍 *Resultado de YouTube:*\n\n🎬 *Titulo*:  ${title}\n👤 *Canal:* ${first.author.name}\n↪️ *Link:* ${url}\n🕐 *Duración:* ${timestamp}\n📅 *Subido:* ${ago}\n👁 *Vistas:* ${views.toLocaleString()}\n`;
      await data.sendImage({ url: thumbnail }, texto);
      const res = await fetch(`https://api.delirius.store/download/ytmp3?url=${url}`);
      const json = await res.json();
      const u = json?.data;
      try {
        await data.sendAudio({ url: u.download });
      } catch (e) {
        data.reply(`No se pudo descargar el Audio, lo lamento`);
        console.log(e);
      }
      break;
    }
    case "ytmp4":
    case "play2":
    case "playvideo":
    case "ytv": {
      // ejemplo pero pats video, lo mismo la api puede dejar de funcionar
      data.found = true;
      if (!data.q) return await data.reply("Debes poner algo para buscar o la URL de un video de YouTube para darte el video");
      const result = await ytSearch(data.q);
      const first = result.videos[0];
      const { url, title, thumbnail, timestamp, ago, views } = first;
      const texto = `♡ *Bot Download* ♡\n🔍 *Resultado de YouTube:*\n\n🎬 *Titulo*:  ${title}\n👤 *Canal:* ${first.author.name}\n↪️ *Link:* ${url}\n🕐 *Duración:* ${timestamp}\n📅 *Subido:* ${ago}\n👁 *Vistas:* ${views.toLocaleString()}\n`;
      await data.sendImage({ url: thumbnail }, texto);
      const res = await convertAndDownload(url, 'mp4')
      const response = await fetch(res.downloadUrl)
      const buffer = Buffer.from(await response.arrayBuffer());
      try {
        await data.sendVideo(buffer, `${title}`);
      } catch (e) {
        data.reply(`No se pudo descargar el video, lo lamento`);
        console.log(e);
      }
      break;
    }
  
    case "get": {
      // comando para obtner el json de una api
      data.found = true;
      if (!data.q) return await data.reply('❌ Pon una URL')
      let res, ju
      try {
        res = await fetch(data.q)
        ju = await res.json()
      } catch (e) {
        return await data.reply(`❌ Error: ${e.message}`)
      }
      await data.reply(`${JSON.stringify(ju, null, 2)}`);
    break;
    }
    case "image":
      // comando para obtner tu foto de perfil
      data.found = true;
      let url = await socket.profilePictureUrl(data.userJid, "image").catch(() => null);
      await socket.sendMessage(data.from, {
        image: { url: url }
      });
    break;
      case "socket":
        data.found = true;
        console.log(socket);
      break;
      case "metadata":
        data.found = true;
      await data.text(JSON.stringify(await data.groupMetadata(data.from), null, 2));
    break;
    case "from": {
      data.found = true;
      const msg = data.messages[0];
      const from = JSON.stringify(msg.key.remoteJid);
      
      console.log(from);
      await data.text(from);
    break;
    }
    case "sender":
      data.found = true;
      await data.reply(data.userJid);
    break;
    case "prueba":
      data.found = true;
      socket.sendMessage(data.from, { text: "um" }, { quoted: data.info });
      break;
     
  }; 
  // el log de comandos xd
  if (data.usedPrefix && data.found === true) {
    const tiempo = new Date().toLocaleTimeString("es-MX");
    const tipo = data.from.endsWith("@g.us") ? chalk.blueBright("GRUPO") : chalk.magenta("PRIVADO");
    const metadata = data.isGroup ? await data.groupMetadata(data.from) : ''
    const nombreGrupo = metadata.subject;
    const grupoTxt = data.isGroup ? chalk.cyan(`[${nombreGrupo}]`) : ''
    const log = `${chalk.green(`[${tiempo}]`)} ${chalk.yellow.bold(`CDM:`)}${chalk.cyan(`${data.usedPrefix + data.commandName}`)} ${chalk.gray("|")} ${chalk.bold(data.pushname || "Desconocido")} (${data.userJid.split("@")[0]}) ${grupoTxt ? grupoTxt : ''} ${chalk.gray("|")} ${tipo}`; 
    console.log(log);
  }
};
export { comandos }