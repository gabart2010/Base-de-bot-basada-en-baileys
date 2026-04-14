import { cleanJid, profileImageData, onlyNumbers } from "./cosas/utils.js";
import { getGroupMetadata } from "./cosas/lib/metadata.js";
async function eventos({socket, updates }) {
  for (const update of updates) {
    const groupId = update.id;
    const botId = cleanJid(socket.user.id);
    let texto = "*[ ACTUALIZACION DE GRUPO ]*\n";
    const metadata = await getGroupMetadata(groupId, socket);
    const participantes = metadata.participants || [];
    if (update.announce !== undefined) {
      texto += `🔒 *Ahora ${update.announce ? 'solo administradores' : 'todos'} pueden enviar mensajes.*\n`; // cuando cambian para que todos o solo admins manden mensajes al grupo
    }

    if (update.subject) {
      texto += `✏️ *Nuevo nombre:* ${update.subject}\n`; // nuevo nombre de grupo
    }

    if (update.desc) {
      texto += `🗒️ *Nueva descripción:* ${update.desc}\n`; //nueva descripcion de grupo
    }

    if (update.restrict !== undefined) {
      texto += `⚙️ *Ahora pueden editar las opciones del grupo:* ${update.restrict ? 'solo administradores' : 'Todos los miembros'}\n`; // para saber si todos o solo miembros pueden editar el info del grupo
    }
    const autorParticipante = participantes.find(p => 
      p.id === update.author || 
      p.lid === update.author || 
      p.phoneNumber === update.author
    );
    const authorJid = autorParticipante?.phoneNumber 
      || autorParticipante?.id?.replace('@lid', '@s.whatsapp.net')
      || update.author.replace('@lid', '@s.whatsapp.net');
    const autor = participantes.find((p) => p.id === authorJid);
    const nombreAutor = autor?.notify || `${authorJid}`;
    texto += `\n👤 *Hecho por:* @${onlyNumbers(nombreAutor)}`;
    const { profileImage } = await profileImageData(authorJid, socket);
    await socket.sendMessage(groupId, {
      image: { url: profileImage },
      caption: texto,
      mentions: [authorJid]
    });
  };
};
export { eventos }