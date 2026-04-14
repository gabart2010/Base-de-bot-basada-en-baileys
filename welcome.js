import { profileImageData, cleanJid, reemplazarVariables } from "./cosas/utils.js";
import { getGroupMetadata } from "./cosas/lib/metadata.js";
async function welcome({ socket, data }) {
  const groupId = data.id;
  const botId = cleanJid(socket.user.id);
  const userJid = data.participants[0].phoneNumber;
  const action = data.action;
  const actor = data.author || '';
  const metadata = await getGroupMetadata(groupId, socket);
  switch (action) {
    case "promote": {
      const grupo = metadata.subject;
      const participantesInfo = metadata.participants;
      const nombreUsuario = participantesInfo.find((p) => p.id === userJid)?.notify || `@${userJid.split('@')[0]}`;
      const nombreActor = participantesInfo.find((p) => p.id === actor)?.notify || `@${actor.split('@')[0]}`;
      const texto = `✅ *Nuevo admin en el grupo* \n*"${grupo}"*\n\n👤 Usuario: ${nombreUsuario}\n🫱 Lo ascendió: ${nombreActor}` // mensake de cuando hay nuevo admin, cambialo si quieres, aca "grupo" es el nombre de grupo, "nombreUsuario" es el nuevo admin y "nombreActor" es el nombre de quien lo hizo admin
      const { profileImage } = await profileImageData(actor, socket);
      socket.sendMessage(groupId, {
       image: { url: profileImage },
       caption: texto,
       mentions: [userJid, actor]
     });            
    break;
    };
    case "demote": {
      const grupo = metadata.subject;
      const participantesInfo = metadata.participants;
      const nombreUsuario = participantesInfo.find((p) => p.id === userJid)?.notify || `@${userJid.split('@')[0]}`;
      const nombreActor = participantesInfo.find((p) => p.id === actor)?.notify || `@${actor.split('@')[0]}`;
      const texto = `❌ *Administrador removido en* \n*"${grupo}"*\n\n👤 Usuario: ${nombreUsuario}\n🫱 Lo degradó: ${nombreActor}` // mensaje de cuando alguien le quita adm a alguien
      const { profileImage } = await profileImageData(actor, socket);
      socket.sendMessage(groupId, {
       image: { url: profileImage },
       caption: texto,
       mentions: [userJid, actor]
     });            
    break;
    };
    case "add": {
      const mens = reemplazarVariables(userJid, metadata, await db.welcome.getWelcome(botId, groupId));
      const { buffer } = await profileImageData(userJid, socket);
      await socket.sendMessage(groupId, {
        image: buffer,
        caption: mens,
        mentions: [userJid]
      });
    break;
    };
    case "remove": {
      const mens = reemplazarVariables(userJid, metadata, await db.welcome.getBye(botId, groupId));
      const { buffer } = await profileImageData(userJid, socket);
      await socket.sendMessage(groupId, {
        image: buffer,
        caption: mens,
        mentions: [userJid]
      });
    break;
    };  
  };
}
export { welcome };