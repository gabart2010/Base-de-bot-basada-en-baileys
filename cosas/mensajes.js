import fs from "fs";
import { getGroupMetadata } from "./lib/metadata.js";
import { cleanJid, getUsedPrefix, esBotFlexible, uploadToCatbox, esAdminFlexible, baileysIs, randomName, profileImageData } from './utils.js';
import { comandos } from '../index.js';
import webp from 'node-webpmux';
import path from "path";
import { generateWAMessage, generateMessageID } from '@whiskeysockets/baileys';
import { packSticker, autorSticker } from "../config.js";

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function procesarMensaje({socket, data}) {
  //socket
  socket.toURL = async (file) => await uploadToCatbox(file); // convierte a URL alguien archivo
  socket.sendAlbumMessage = async (jid, medias, options = {}) => {
    const albumKey = {
      remoteJid: jid,
      id: generateMessageID(),
      fromMe: true,
    };
    const albumMessage = {
      albumMessage: { expectedImageCount: medias.length }
    };
    await socket.relayMessage(jid, albumMessage, { messageId: albumKey.id });
    for (let i = 0; i < medias.length; i++) {
      const media = medias[i];
      const imgMessage = await generateWAMessage(
        jid,
        { image: media.data, ...(i === 0 ? { caption: options.caption || "" } : {}) },
        { upload: socket.waUploadToServer }
      );
      imgMessage.message.messageContextInfo = {
        messageAssociation: {
          associationType: 1,
          parentMessageKey: albumKey
        }
      };
      await socket.relayMessage(jid, imgMessage.message, { messageId: imgMessage.key.id });
      await delay(options.delay || 500);
    }
  }; // dificil de explicar pero es para mandar en formato albun muchas fotos
  //data
  if (!data?.messages?.length) return null
  const info = data.messages[0]
  if (!info.message) return null
  //console.log(info);
  const textMessage = info.message?.conversation
  const extendedTextMessage = info.message?.extendedTextMessage
  const extendedTextMessageText = extendedTextMessage?.text
  const imageTextMessage = info.message?.imageMessage?.caption
  const videoTextMessage = info.message?.videoMessage?.caption
  const body = textMessage || extendedTextMessageText || imageTextMessage || videoTextMessage 
  const date = new Date()

  data.info = info;
  data.mtype = Object.keys(info.message)[0];
  data.body = body || ''; // viene siendo el texto completo, con el comando y todo, ejemplo si mandan "!hola botsito" data.body seria todo ese texto
  data.from = info?.key?.remoteJid; // id de donde viene el chat, puede ser de grupo, privado o canal, si es de grupo terminara con "@g.us", en cabio si es de canal terminara con "@newsletter", pero si es priv terminara con el jid del usuario
  data.isGroup = data.from?.endsWith('@g.us'); // para saber si de donde viene es un grupo, esto devuelve true o false, perfecto para if
  data.isChanel = data.from?.endsWith('@newsletter'); // saber si es un canal, devuelve true o false
  data.dia = date.toLocaleDateString("es-mx"); // dia, cambia a tu zona horaria
  data.hora = date.toLocaleTimeString("es-mx");  // la hora, lo mismo cambiala a tu zona horaria
  data.groupMetadata = async (from) => await getGroupMetadata(from, socket); // obtener metadatos del grupo, puedes usarla con await data.groupMetadata(data.from);
  const metadata = data.isGroup ? await data.groupMetadata(data.from) : ''
  const participants = metadata.participants || [];
  const rawJid = (info?.key?.participant || info?.key?.remoteJid)?.replace(/:[0-9]{1,2}/g, '');
  data.userJid = resolveJid(rawJid, participants); // el id del usuario que mando el mensaje, estos siempre terminan con "@s.watsapp.net" y empieza con el numero del usuario, ejempli: "52199999999@s.whatsapp.net", a menos que el usuario se saliera del grupo ppr que ahi termina con "@lid"
  data.isReply = !!extendedTextMessage?.contextInfo?.quotedMessage; // para saber si el mensaje esta respondiendo a otro, lo que devuelve esto es un booleano, osea tru y false, perfecto para if
  const replyJid = extendedTextMessage?.contextInfo?.participant || null;
  data.replyJid = resolveJid(replyJid, participants); // si le responde a alguien, esta cosa devuelve el jid de a quien le respondio el mensaje
  data.found = false; // para los logs de comandos xd
  data.usedPrefix = getUsedPrefix(body?.trim()); // para obtener el prefijo usado, ejemplo si mandan "!hola" data.usedPrefix seria "!", o si usan ".hola", data.usedPrefix seria ".", aun que si no hay pregijo esto devuelve false
  data.botId = cleanJid(socket.user.id); // id del bot, no parece muy util pero lo es
  data.profileImage = async (jid) => await profileImageData(jid, socket); // obtener la foto de perfil de algun usuario
  data.isBot = esBotFlexible(socket, data.userJid);  // para saber si es bot xd
  data.userTag = data.userJid?.split('@')[0] || "usuario";
  data.pushname = info.pushName || ''; // el pushname es el nombre del usuario, ojo no siempre hay
  data.isImage = baileysIs(info, "image"); // si el mensaje es imagen
  data.isVideo = baileysIs(info, "video"); // si el mensaje es video 
  data.isSticker = baileysIs(info, "sticker");  // si el mensaje es sticker
  data.ban = async (from, userJid) => {
    await socket.groupParticipantsUpdate(from, [userJid], "remove");
  }  // para banear a alguien, aca el priemer parametro (from) es para saber de donde, osea de que grupo pertenece el que sera baneado, y dl userJid es quien, cada usuario tiene un jid y de ese lo baneamos

  if (data.usedPrefix && body) {
    const withoutPrefix = body.slice(data.usedPrefix.length)
    const [commandNameRaw, ...argsRaw] = withoutPrefix.trim().split(/\s+/)
    data.commandName = commandNameRaw?.toLowerCase(); // para obtener el comando, ejemplo si usan "!hola", data.commandName seria "hola", si ponen "!hola botsito lindo", data.commandName seguiria siendo "hola", este solo cambia cuando el comando cambia
    data.argsRaw = argsRaw
    data.q = argsRaw.join(' ')  // esto viene siendo lo que tiene el mensaje despues del comando, ejemplo si yo digo "!data hola" data.q viene siendo "hola"

    const mentionedJid = info.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    const men = resolveJid(mentionedJid, participants) || '';
    data.labelJid = !data.isReply ? men : data.replyJid;  // obener el usuario si le responde a alguien
    data.mentionQuery = data.labelJid?.split('@')[0] || null
    data.mentionUser = data.userJid?.split('@')[0] || null;
  } else {
    data.commandName = ''
    data.argsRaw = []
    data.q = ''
  }

  const checkUserRole = async (jid, type) => {
    try {
      if (!data.isGroup) return false;
      const { participants, owner } = await data.groupMetadata(data.from)
      const participant = participants.find(p => p.phoneNumber === jid || p.id === jid)
      if (!participant) return false
      const isOwnerGrupo = jid === owner || participant.admin === 'superadmin'
      const isAdmin = participant.admin === 'admin'
      if (type === 'admin') return isAdmin || isOwnerGrupo
      if (type === 'owner') return isOwnerGrupo
      return false
    } catch {
      return false
    }
  };
  data.reply = async (text, mentions = []) => {
    await socket.sendMessage(data.from, {
      text: text,
      mentions: mentions
    }, { quoted: data.info});
  };  // funcion para responder con reply al mensaje original 
  data.sendImage = async (buffer, text = '', mention = []) => {
    if (text === '') {
      return await socket.sendMessage(data.from, {
        image: buffer
      }, { quoted: data.info })
    } else {
      await socket.sendMessage(data.from, {
        image: buffer,
        mimetype: 'image/png',
        caption: text,
        mentions: mention
      }, { quoted: data.info })
    }
  };  // funcion para mandar una imagen con caption o sin caption (caption viene siendo el texto que acompaña a la imagen)
  data.sendVideo = async (buffer, text = '', mention = []) => {
    if (text === '') {
      return await socket.sendMessage(data.from, {
        video: buffer
      }, { quoted: data.info })
    } else {
      await socket.sendMessage(data.from, {
        video: buffer,
        caption: text,
        mentions: mention
      }, { quoted: data.info })
    }
  };  // funcion para mandar un video con o sin caprion
  data.sendGif = async (buffer, texto = '', mention = []) => {
        if (text === '') {
      return await socket.sendMessage(data.from, {
        video: buffer,
        gifPlayback: true
      }, { quoted: data.info })
    } else {
      await socket.sendMessage(data.from, {
        video: buffer,
        caption: text,
        gifPlayback: true,
        mentions: mention
      }, { quoted: data.info })
    }
  };  // funcion para mandar un gif con o sin caprion
  data.sendAudio = async (buffer, nota = false) => {
    if (nota !== true && nota !== false) nota = false
    await socket.sendMessage(data.from, {
      audio: buffer,
      mimetype: nota ? 'audio/ogg; codecs=opus' : 'audio/mp4',
      ptt: nota
    }, { quoted: data.info })
  };  // funcion para mandar un audio (aca no se puede caption, dato curioso: si le pones al segindo parametro un true el audio se manda como nota de voz)
  data.text = async (text, mentions = []) => {
    await socket.sendMessage(data.from, {
      text: text,
      mentions: mentions
    });
  };  // funcion para mandar un texto (sin reply)
  data.react = async (emoji) => {
    await socket.sendMessage(data.from, {     react: {
          text: emoji,
          key: data.info.key,
        }
    });
  }; // funcion para reaccionar
  data.stickerFromFile = async (file) => {
    const buffer = await addStickerMetadata(file);
    return await socket.sendMessage(
      data.from,
      { sticker: buffer },
      { quoted: data.info }
    )
  };
  data.stickerFromBuffer = async (file) => {
    const buffer = await addStickerMetadata(file);
    return await socket.sendMessage(
      data.from,
      { sticker: buffer },
      { quoted: data.info }
    )
  };
  data.isAdmin = async (jid) => await checkUserRole(jid, 'admin') || data.isBot;  // funcion para saber si el usuario es admin
  data.isOwner = async (jid) => await checkUserRole(jid, 'owner') || data.isBot;  // funcion para saber si el usuario es el owner del grupo
  data.isBotAdmin = async (from) => await esAdminFlexible(socket, data);  // para saber si el bot es admin
  
  comandos({ socket, data });
}

function resolveJid(rawJid, participants) {
  if (!rawJid?.includes('@lid')) return rawJid;
  
  const match = participants.find(p => 
    p.lid === rawJid || p.id === rawJid
  );
  
  return match?.phoneNumber || match?.id?.replace('@lid', '@s.whatsapp.net') || rawJid;
}

async function addStickerMetadataBuffer(webpBuffer, packname = packSticker, author = autorSticker) {
  const tmpFileOut = webpBuffer;

  const img = new webp.Image()
  const json = {
    'sticker-pack-id': 'bot',
    'sticker-pack-name': packname,
    'sticker-pack-publisher': author,
    'emojis': ['🤖']
  }

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00
  ])
  const jsonBuff = Buffer.from(JSON.stringify(json), 'utf-8')
  const exif = Buffer.concat([exifAttr, jsonBuff])
  exif.writeUIntLE(jsonBuff.length, 14, 4)
  await img.load(webpBuffer)
  img.exif = exif
  await img.save(tmpFileOut)

  const result = fs.readFileSync(tmpFileOut)
  fs.unlinkSync(tmpFileOut)
  return result
}

async function addStickerMetadata(webpBuffer, packname = packSticker, author = autorSticker) {
  const tmpFileIn = path.resolve('temp', randomName('webp'))
  const tmpFileOut = path.resolve('temp', randomName('webp'))

  fs.writeFileSync(tmpFileIn, webpBuffer)

  const img = new webp.Image()
  const json = {
    'sticker-pack-id': 'bot',
    'sticker-pack-name': packname,
    'sticker-pack-publisher': author,
    'emojis': ['🤖']
  }

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00
  ])
  const jsonBuff = Buffer.from(JSON.stringify(json), 'utf-8')
  const exif = Buffer.concat([exifAttr, jsonBuff])
  exif.writeUIntLE(jsonBuff.length, 14, 4)

  await img.load(tmpFileIn)
  fs.unlinkSync(tmpFileIn)
  img.exif = exif
  await img.save(tmpFileOut)

  const result = fs.readFileSync(tmpFileOut)
  fs.unlinkSync(tmpFileOut)
  return result
}

export { procesarMensaje }