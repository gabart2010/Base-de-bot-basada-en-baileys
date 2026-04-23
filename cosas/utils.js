import { Catbox } from 'node-catbox';
import fs from "fs";
import path from "path";
import logs from "./logs.js"
import { writeFile } from "node:fs/promises";
import { PREFIXES, numBot } from "../config.js";
import { getGroupMetadata } from "./lib/metadata.js";
import { downloadContentFromMessage } from '@whiskeysockets/baileys';

const catbox = new Catbox();
const cleanJid = (jid = "") => jid.split(":")[0];

function getUsedPrefix(text = "") {
  return PREFIXES.find(p => text.startsWith(p)) || null;
}

function validarJid(jid) {
  return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')
}

function esBotFlexible(socket, senderJid) {
  if (!socket?.authState?.creds?.me) return false
  const botJid = socket.authState.creds.me.id || ""
  const botLid = socket.authState.creds.me.lid || ""
  const sender = cleanJid(senderJid)
  const bot = cleanJid(botJid)
  const lid = cleanJid(botLid)
  return (
    sender === bot ||
    senderJid === botJid ||
    senderJid === `${bot}@s.whatsapp.net` ||
    senderJid === `${lid}@lid`
  )
}

async function uploadToCatbox(filePath) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
  if (!fs.existsSync(absolutePath)) return null
  return await catbox.uploadFile({ path: absolutePath })
}

async function profileImageData(userJid, socket) {
  const defaultPath = path.resolve("cosas", "multiMedia", "png", "default.jpg");
  const tempPath = path.resolve("temp", `profile_${Date.now()}.jpg`);

  try {
    const url = await socket.profilePictureUrl(userJid, "image").catch(() => null);
    if (!url) throw new Error("No pic");

    const response = await fetch(url);
    if (!response.ok) throw new Error("Download failed");

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(tempPath, buffer);

    return {
      buffer,
      profileImage: tempPath,
      success: true
    };
  } catch {
    const buffer = fs.readFileSync(defaultPath);
    return {
      buffer,
      profileImage: defaultPath,
      success: false
    };
  }
}

function randomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomName(extension) {
  const fileName = randomNumber(0, 999999);

  if (!extension) {
    return fileName.toString();
  }

  return `${fileName}.${extension}`;
};

async function reemplazarVariables(data, texto) {
  const date = new Date();
  const metadata = await getGroupMetadata(data.from);
  const nombreGrupo = metadata.subject;
  const totalMiembros = metadata.participants.length;
  const day = date.toLocaleDateString("es-MX", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const hour = date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  return texto
    .replace(/@user/gi, `@${data.userJid.split('@')[0]}`)
    .replace(/@group/gi, nombreGrupo)
    .replace(/@members/gi, totalMiembros.toString())
    .replace(/@day/gi, day)
    .replace(/@hour/gi, hour);
}

async function esAdminFlexible(socket, data) {
  try {
    const metadata = await data.groupMetadata(data.from);
    const rawBotId = data.botId
    const botLid = socket?.authState?.creds?.me?.lid || '';
    const botLidRaw = botLid.split(':')[0];
    const botIdBase = rawBotId.split(':')[0];
    const posiblesIds = new Set([
      `${botIdBase}@s.whatsapp.net`,
      `${botLidRaw}@lid`,
      rawBotId,
      botLid
    ]);
    const participante = metadata.participants.find(p => posiblesIds.has(p?.id) || posiblesIds.has(p?.jid));
    return participante?.admin === 'admin' || participante?.admin === 'superadmin';
  } catch (err) {
    console.error('❌ Error en esAdminFlexible:', err);
    return false;
  }
}

function esEsteBot(botJidCompleto, jid) {
  const baseBotId = cleanJid(botJidCompleto);
  const baseJid = cleanJid(jid);
  return (
    baseJid === baseBotId || 
    jid === `${baseBotId}@s.whatsapp.net` || 
    jid === `${baseBotId}@lid` || 
    jid === botJidCompleto
  );
}

function pickRandom(list) { 
  return list[Math.floor(Math.random() * list.length)]
}

function onlyNumbers(text) {
  if (!text) return "";
  return text.replace(/[^0-9]/g, "");
}

function getContent(info, context) {
  return (
    info.message?.[`${context}Message`] ||
    info.message?.extendedTextMessage?.contextInfo?.quotedMessage?.[
      `${context}Message`
    ]
  );
}

function baileysIs(info, context) {
  return !!getContent(info, context);
}

async function download(info, fileName, context, extension) {
  const content = getContent(info, context);

  if (!content) {
    throw new Error(`No se encontró un mensaje del tipo "${context}" para descargar.`);
  }

  const stream = await downloadContentFromMessage(content, context);

  let buffer = Buffer.from([]);

  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
  }

  const filePath = path.resolve('temp', `${fileName}.${extension}`);

  await writeFile(filePath, buffer);

  return filePath;
}

function deleteTempFile(file) {
  setTimeout(() => {
    try {
      if (file && fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (error) {
      errorLog(
        "Error al eliminar un archivo temporal!\n\n",
        JSON.stringify(error, null, 2)
      );
    }
  }, 30_000);
}

export { cleanJid, getUsedPrefix, validarJid, esBotFlexible, uploadToCatbox, reemplazarVariables, randomNumber, randomName, profileImageData, esAdminFlexible, esEsteBot, pickRandom, onlyNumbers, baileysIs, download, deleteTempFile }