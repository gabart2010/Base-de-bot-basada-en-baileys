# COMANDOS PARA LA INSTALACION POR TERMUX

```
termux-setup-storage
```
```
apt update && apt upgrade && pkg update && pkg upgrade && pkg install bash && pkg install libwebp && pkg install git -y && pkg install nodejs -y && pkg install ffmpeg -y && pkg install wget && pkg install imagemagick -y && pkg install yarn
```
```
cd
```
```
git clone https://github.com/gabart2010/Base-de-bot-basada-en-baileys.git
```
```
cd ~/Base-de-bot-basada-en-baileys
```
#### ojo aca puede tardar algo al instalar los modulos
```
npm i
```
```
mv ~/Base-de-bot-basada-en-baileys /sdcard/
```
### Con esto los paquetes de esta base deberian estar en tu MT manager

----------

# ⚠️ ADVERTENCIA ⚠️

### TEN MUY EN CUENTA QUE LOS BOTS DE TERMUX NO SON 24/7 PARA ESO NECESITAS PAGAR PARA UN SERVIDOR, YO NO PUEDO RECOMENDARTE SERVIDORES

----------
# GUIA DE LA BASE

## Como enviar MENSAJES con esta base

<details>
  <summary> <b> Toca para ver info. </b></summary>
  
  #### Mensajes SIN responder al mensaje original
  
```js
// para enviar MENSAJES
await data.text("EL TEXTO QUERIDO");
// para enviar MENSAJES pero ETIQUETANDO A ALGUIEN o ALGUIENES
await data.text("EL TEXTO QUERIDO", ["LOS JIDS QUE SERAN ETIQUETADOS"]);
```
  
  #### Mensaje RESPONDIENDO al mensaje original
  
```js
 // para enviar MENSAJES
await data.reply("EL TEXTO QUERIDO");
// para enviar MENSAJES pero ETIQUETANDO A ALGUIEN o ALGUIENES
await data.reply("EL TEXTO QUERIDO", ["LOS JIDS QUE SERAN ETIQUETADOS"]);
```
  
  <details>
  <summary><b> Mensaje con FOTO RESPONDIENDO al mensaje original </b></summary>
  
  #### Foto mediante ruta (almacenamiento)
  
```js
import fs from "fs";
// SIN texto
await data.sendFoto(fs.readFileSync("/La/Ruta/De/La/Foto.png"));
// CON texto sin mensiones
await data.sendFoto(fs.readFileSync("/La/Ruta/De/La/Foto.png"), "EL TEXTO QUERIDO");
// CON texto CON mensiones
await data.sendFoto(fs.readFileSync("/La/Ruta/De/La/Foto.png"), "EL TEXTO QUERIDO", ["LOS JIDS DE QUIENES SERAN ETIQUETADOS"]);
```

  #### Foto mediante URL (ojo, la URL tiene que mandar directamente a la imagen)
  
```js
// SIN texto
await data.sendFoto({ url: "https://la.url/de/la/imagen.png" });
// CON texto sin mensiones
await data.sendFoto({ url: "https://la.url/de/la/imagen.png" }, "EL TEXTO QUERIDO");
// CON texto CON mensiones
await data.sendFoto({ url: "https://la.url/de/la/imagen.png" }, "EL TEXTO QUERIDO", ["LOS JIDS DE QUIENES SERAN ETIQUETADOS"]);
```

  </details>
  <details>
    <summary><b> Mensaje con VIDEO RESPONDIENDO al mensaje original </b></summary>
  
  #### Video mediante ruta (almacenamiento)
  
```js
import fs from "fs";
// SIN texto
await data.sendVideo(fs.readFileSync("/La/Ruta/De/El/Video.mp4"));
// CON texto sin mensiones
await data.sendVideo(fs.readFileSync("/La/Ruta/De/El/Video.mp4"), "EL TEXTO QUERIDO");
// CON texto CON mensiones
await data.sendVideo(fs.readFileSync("/La/Ruta/De/El/Video.mp4"), "EL TEXTO QUERIDO", ["LOS JIDS DE QUIENES SERAN ETIQUETADOS"]);
```

  #### Video mediante URL (ojo, la URL tiene que mandar directamente a el video)
  
```js
// SIN texto
await data.sendVideo({ url: "https://la.url/de/el/video.mp4" });
// CON texto sin mensiones
await data.sendVideo({ url: "https://la.url/de/el/video.mp4" }, "EL TEXTO QUERIDO");
// CON texto CON mensiones
await data.sendVideo({ url: "https://la.url/de/el/video.mp4" }, "EL TEXTO QUERIDO", ["LOS JIDS DE QUIENES SERAN ETIQUETADOS"]);
```
  </details>
  
  <details>
    <summary><b> Mensaje con GIF RESPONDIENDO al mensaje original </b></summary>
    
  ### ten en cuenta que los gif se mandan como si fuera video, pero whatsapp los recibira como gif (gracias a la funcion)
  
  #### Gif mediante ruta (almacenamiento)
  
```js
import fs from "fs";
// SIN texto
await data.sendGif(fs.readFileSync("/La/Ruta/De/El/Gif.mp4"));
// CON texto sin mensiones
await data.sendGif(fs.readFileSync("/La/Ruta/De/El/Gif.mp4"), "EL TEXTO QUERIDO");
// CON texto CON mensiones
await data.sendGif(fs.readFileSync("/La/Ruta/De/El/Gif.mp4"), "EL TEXTO QUERIDO", ["LOS JIDS DE QUIENES SERAN ETIQUETADOS"]);
```

  #### Gif mediante URL (ojo, la URL tiene que mandar directamente a el video)
  
```js
// SIN texto
await data.sendGif({ url: "https://la.url/de/el/Gif.mp4" });
// CON texto sin mensiones
await data.sendGif({ url: "https://la.url/de/el/Gif.mp4" }, "EL TEXTO QUERIDO");
// CON texto CON mensiones
await data.sendGif({ url: "https://la.url/de/el/Gif.mp4" }, "EL TEXTO QUERIDO", ["LOS JIDS DE QUIENES SERAN ETIQUETADOS"]);
```
  </details>

  <details>
    <summary><b> Audio RESPONDIENDO al mensaje original </b></summary>
  
  #### Audio mediante ruta (almacenamiento) (por cierto, los audios no pueden tener texto)
  
```js
import fs from "fs";
// Como audio normal
await data.sendAudio(fs.readFileSync("/La/Ruta/De/El/Audio.mp3"));
// Audio mandado como nota de voz
await data.sendAudio(fs.readFileSync("/La/Ruta/De/El/Audio.mp3"), true);
```

  #### Audio mediante URL (ojo, la URL tiene que mandar directamente a el audio)
  
```js
// Como audio normal
await data.sendAudio({ url: "https://la.url/de/el/audio.mp3" });
// Audio mandado como nota de voz
await data.sendAudio({ url: "https://la.url/de/el/Audio.mp3" }, true);
```
  </details>
  
  #### Reacciona al mensaje

```js
// en emoji es literalmente el emoji
await data.react("EL EMLOJI");
```
</details>

-----

# OBTNEER DATOS DE GRUPOS

## Para obtener los datos de un grupo en formato json es posible con:

```js
const metadata = await data.groupMetadata("LA ID DEL GRUPO");
```
#### La constante "data" deberia tener el siguiente JSON (pero con los datos del grupo):

<details>
  <summary><b> toca para ver el json de la constante data </b></summary>

```js
{
  "id": "xxxxxxxxxxxx@g.us", // Id del grupo
  "addressingMode": "lid", // su tipo de jid
  "subject": "NOMBRE DEL GRUPO", // nombre del grupo
  "subjectOwner": "xxxxxxxxxxxxxx@lid", // jid del ultimo usuario que cambio el nombre del grupo en formato @lid
  "subjectOwnerPn": "xxxxxxxxxxxx@s.whatsapp.net", // jid del ultimo usuario que cambio el nombre del grupo en formato @s.whatsapp.net
  "subjectTime": 99999999, // tiempo de la ultima vez que se cambio el nombre del grupo
  "size": xx, // cantidad de miembros que hay
  "creation": 999999999, // tiempo de haber sido creado el grupo
  "owner": "xxxxxxxxxxx@lid", // jid del creador del grupo en formato @lid
  "ownerPn": "xxxxxxxxxx@s.whatsapp.net", // jid del creador del grupo en formato @s.whatsapp.net
  "owner_country_code": "??", // codigo del pais del creador del grupo
  "desc": "DESCRIPCION DEL GRUPO", // descripcion del grupo
  "descId": "????????????????", // id del mensaje que cambio la descripcion del grupo
  "descOwner": "xxxxxxxx@lid", // jid del ultimo que cambio la descripcion en formato lid
  "descOwnerPn": "xxxxxxxxxxx@s.whatsapp.net", // jid ddl ultimo que cambio la descripcion del grupo en formato @s.whatsapp.net
  "descTime": 9999999, // tiempo en el que fue cambiada la descripcion
  "restrict": false/true, // si esta en false es por que todos pueden cambiar los datos del grupo, si esta en true solo administradores pueden
  "announce": false/true, // si esta en false todos pueden enviar mensajes, si esta en true solo los admins pueden
  "isCommunity": false/true, // si esta en true, es por que el grupo en realidad es una comunidad  si esta en false es un grupo normal
  "isCommunityAnnounce": false/true, // lo msimo de los mensajes pero para la conunidad
  "joinApprovalMode": true/false, // si esta en true para añadir alguien se necesita que el admin lo acepte, de lo contrario siempre se pueden unir
  "memberAddMode": true/false, // si esta en true TODOS los miembros pueden añadir a alguien, si esta en false solo los admins pueden
  "participants": [ // bloque de participantes
    {
      "id": "xxxxxxxxxxx@lid", // jid del participante en @lid
      "phoneNumber": "xxxxxxxxxx@s.whatsapp.net", // jid del participante en formato @s.whatsapp.net 
      "admin": "superadmin" // si es admin o no, superadmin es owner del grupo, admin es administrador y si esta en null solo es participante
    },
    {
      "id": "xxxxxxxxxxx@lid",
      "phoneNumber": "xxxxxxxx@s.whatsapp.net",
      "admin": null
    },
    // .... y asi puede ir hasta todos los miembros del grupo ....
  ]
}
```

</details>

-----

## Cosas para grupos:

#### como banear de grupos a usuarios:
```js
await data.ban("ID DEL GRUPO EN EL QUE ESTA RL USUARIO QUE SERA BANEADO", "ID DEL USUARIO BANEADO@s.whatsapp.net")
```

#### Como saber si un usuario es administrador o es owner del grupo:

```js
// ojo el ejemplo que doy aca es de un if, de una condicion, ya que la funcion devuelve booleanos:
// para administraodres
await data.isAdmin("ID DEL USUARIO PARA CHECAR QUE ES ADM") // si es administrador correra devolvera true, de lo contrario devolvera false
// Para saber si es Owner del grupo:
await data.isOwner("ID DEL USUARIO PARA CHECAR SI ES OWNER") // si es owner del grupo devolvera true, de lo contrario devolvera false
```

#### como checar si el bot es administrador:
```js
await data.isBotAdmin("ID DEL GRUPO AL QUE SE CHECARA SI ES ADMIN") // si el bot es admin devurle true, de lo contrario devuelve false
```

#### Como checar si el usuario es el mismo bot

```js
// esta igual devuelve booleanos
data.isBot // si es el bot devuelve true, de lo contrio devuelve false
```

#### como hacer o quitar admin a alguien del grupo (El bot tiene que tener admin)

```js
// para dar administrador:
socket.groupParticipantsUpdate("ID DEL GRUPO", ["ID DEL USUARIO QUE SERA ADMIN"], 'promote')
// para quitar administrador:
socket.groupParticipantsUpdate("ID DEL GRUPO", ["ID DEL USUARIO QUE LE QUITARAN ADMIN"], 'demote')
```

#### Como abrir o cerrar el grupo (se necesita que el bot sea administrador):

```js
// para abrir el grupo:
socket.groupSettingUpdate("ID DEL GRUPO", 'not_announcement');
// para cerrar el grupo:
socket.groupSettingUpdate("ID DEL GRUPO", 'announcement');
```

#### como cambiar la descripcion de un grupo (se necesita que el bot sea administrador):

```js
socket.groupUpdateDescription("ID DEL GRUPO", `LA NUEVA DESCRIPCION`);
```

#### como cambiar el nombre del grupo (se necesita que el bot sea administrador):

```js
socket.groupUpdateSubject("ID DEL GRUPO", `EL NUEVO NOMBRE DE GRUPO`);
```

#### como transformar un buffer a url, osea subirlo a catbox:

```js
// "file" aca es el buffer ee una imagen, audio, video, gif o lo que sea
await socket.toUTL(file)
```

-----

#### cosas utiles de la base:

```js
// puedes acceder al id de donde se envio mensajes, se puede con grupos, canales o privados:
data.from // xxxxxxx@g.us (grupos) . xxxxxxx@newsletter (canal) . xxxxxxxx@s.whatsapp.net (privado)
// puedes acceder al jid del usuario que mando el mensaje con:
data.userJid // xxxxxxx@s.whatsapp.net
// puedes acceder al prfijo que se uso con:
data.usedPrefix // ".", ",", "/"... etc.
// puedes acceder al mensaje completo con (incluso si no hay prefijo):
data.body // si el texto es "hola mis niños" data.body es "hola mis niños", y si es ".saludar @usuario" data.body es ".saludar @usuario"
// puedes acceder al comando usado con:
data.commandName // ejemplo si el mensaje es "!hola usuarios" data.commandName es "hola"
// puedes acceder al texto qye hay despues del comando con:
data.q // si el texto es "!saludar a todos awebo" data.q es "a todos awebo" (dato: si no hay texto despues de comando devuelve false)
// aceder a la ID del bot:
data.botId // si tu bot tiene de numero "52199999999" tu id del bot seria tu mismo numero, por ende es unico
// para acceder al nombre de usuario:
data.pushname // es el nombre que se dan los usuarios
```
-----

#### cosas de la base que devuelven booleanos (true o false):

```js
// para ver si es un grupo (true) o no lo es (false)
data.isGroup // si es un grupo (osea termina con @g.us su id) esto devolvera true, en cambio si no lo es devolvera false
// para ver si es un canal (true) o no lo es (false)
data.isChanel // si es un canal (osea termina con @newsletter su id) esto devolvera true, en cambio si no lo es devolvera false
// para saber si el mensaje esta respondiendo a otro mensaje:
data.isReply // si esta respondiendo a otro mensaje devolvera true, de lo contrario devolvera false
```

-----

## Para contactar al creador de la base (y el del tiktok xd):

#### whatsapp:

[
![WhatsApp](https://img.shields.io/badge/WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)
](https://wa.me/5216679530256)

#### canal de whatsapp (nose):

[
![Canal WhatsApp](https://img.shields.io/badge/Canal-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)
](https://whatsapp.com/channel/0029VbBt1d6FnSzCgDQFDf3R)

#### Tiktok principal (ignora los videos, son ouro humor, pero si me sigues te lo agradeceria):

[
![TikTok](https://img.shields.io/badge/TikTok-000000?style=for-the-badge&logo=tiktok&logoColor=white)
](https://tiktok.com/@gabart2010)

#### Tiktok de la cuenta de los video: 

[
![TikTok](https://img.shields.io/badge/TikTok-000000?style=for-the-badge&logo=tiktok&logoColor=white)
](https://tiktok.com/@no.sono2027)