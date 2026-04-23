import NodeCache from 'node-cache';
import pino from 'pino';
import chalk from "chalk";
import fs from "fs";
import { eventos } from "./events.js";
import { chanelJid } from "./config.js";
import { procesarMensaje } from './cosas/mensajes.js';
import { makeMessagesSocket } from "./cosas/lib/newsletters/Utils/messages-send.js";
import { invalidateGroup } from "./cosas/lib/metadata.js";
import readline from "readline";
import { welcome } from "./welcome.js";
import {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  DisconnectReason,
  delay,
  isJidStatusBroadcast,
  isJidBroadcast,
  proto,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';

let pairingRequested = false;
const msgRetryCounterCache = new NodeCache();

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
  process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
}); //Procesamiento de errores, para que si pasa algo no se apage el bot xd

async function startSocket() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth')

  const { version } = await fetchLatestBaileysVersion()

  const socket = makeMessagesSocket({
    version,
    logger: pino({ level: "error" }),
    printQRInTerminal: false,
    defaultQueryTimeoutMs: 60 * 1000,
    auth: state,
    msgRetryCounterCache,
    customUploadHosts: [],
    browser: ['Windows', 'Chrome', '120.0.0'],
    keepAliveIntervalMs: 60 * 1000,
    markOnlineOnConnect: true,
    patchMessageBeforeSending: (msg) => msg,
    emitOwnEvents: true,
    getMessage: async (key) => {
      return { conversation: '' } 
    }
  }); // el socket, la palabra de conexion ps
    if (!socket.authState.creds.registered) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const question = (text) => new Promise((resolve) => rl.question(text, resolve))
    let number = await question(
      chalk.cyan("📱 Escribe tu número de WhatsApp con código de país (solo números): ")
    );
    rl.close();
    process.stdin.destroy()
    number = number.replace(/[^0-9]/g, "");

    if (!number) {
      console.log(chalk.red("❌ Número inválido."));
      process.exit(1);
    }

    console.log(chalk.yellow("⌛ Solicitando código de vinculación..."));
    try {
      const code = await socket.requestPairingCode(number);
      console.log(chalk.bgGreen.black("✅ CÓDIGO DE VINCULACIÓN:"), chalk.white(code));
    } catch (err) {
      console.error(chalk.red("❌ Error al generar código de vinculación:"), err.message);
      process.exit(1);
    }
  };
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update
    const statusCode = lastDisconnect?.error?.output?.statusCode;

    if (connection === 'close') {
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      switch (statusCode) {
        case 428:
          console.log(chalk.red('❌ Sesión cerrada, intentando reconectar...'))
          break
        case DisconnectReason.connectionClosed:
          console.log(chalk.yellow('🔌 Conexión cerrada, reconectando...'))
          break
        case DisconnectReason.connectionLost:
          console.log(chalk.yellow('📡 Señal perdida, reconectando...'))
          break
        case DisconnectReason.connectionReplaced:
          console.log(chalk.blue('📱 Sesión abierta en otro dispositivo.'))
          break
        case DisconnectReason.timedOut:
          console.log(chalk.yellow('⏱️ Tiempo de espera agotado, reconectando...'))
          break
        case DisconnectReason.badSession:
          console.log(chalk.bold.red('💾 Sesión corrupta, borra la carpeta /auth y reconecta.'))
          break
        case DisconnectReason.restartRequired:
          console.log(chalk.yellow('🔄 Reinicio requerido por WhatsApp.'))
          break
        case DisconnectReason.multideviceMismatch:
          console.log(chalk.yellow('⚠️ Error de multi-dispositivo, reconectando...'))
          break
        default:
          console.log(chalk.bold.yellow(`⚠️ Desconexión desconocida, código: ${statusCode}`))
          break
      }

      startSocket();
    }

    if (connection === 'open') {
      pairingRequested = true;
      console.log(chalk.green('✅ Bot conectado correctamente.'))
    }
    });
  socket.ev.on('creds.update', saveCreds)
  
  socket.ev.on('messages.upsert', async (data) => await procesarMensaje({ socket, data })); // gracias a este recibes mensajes
  
  socket.ev.on('groups.update', async (updates) => {
    updates.forEach((update) => invalidateGroup(update.id));
    await eventos({ socket, updates });
  }); // gracias a este recibes actualizaciones de grupo

  socket.ev.on('group-participants.update', async (data) => {
    invalidateGroup(data.id);
    await welcome({ socket, data });
  }); // y gracia a este actualizaciónes de usuaruos (admin nuevo, menos 1 admin, bienvenidas y despedidas)

  return socket
}
startSocket()