// Hecho por Ado :D
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const getTimestamp = () => Math.floor(Date.now() / 1000);

function extractJsonArray(html) {
    const match = html.match(/var json = JSON\.parse\('(\[.*?\])'\);/);
    if (!match) throw new Error("No se pudo encontrar el arreglo JSON de autenticación en la página principal.");
    return JSON.parse(match[1]);
}

function generateAuth(jsonArray) {
    let e = "";
    for (let t = 0; t < jsonArray[0].length; t++) {
        e += String.fromCharCode(jsonArray[0][t] - jsonArray[2][jsonArray[2].length - (t + 1)]);
    }
    if (jsonArray[1]) {
        e = e.split("").reverse().join("");
    }
    return e.length > 32 ? e.substring(0, 32) : e;
}

function extractVideoId(url) {
    let match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (!match) throw new Error("URL de YouTube inválida.");
    return match[1];
}

export async function convertAndDownload(youtubeUrl, format = 'mp3') {
    if (!['mp3', 'mp4'].includes(format)) throw new Error("Formato inválido. Usa 'mp3' o 'mp4'.");
    
    const videoId = extractVideoId(youtubeUrl);
    
    let response = await fetch("https://ytmp3.gs/", {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5'
        }
    });
    const html = await response.text();
    
    const jsonArray = extractJsonArray(html);
    const authKey = generateAuth(jsonArray);
    const paramName = String.fromCharCode(jsonArray[6]);
    
    const gB = "epsiloncloud.org";
    
    const initUrl = `https://epsilon.${gB}/api/v1/init?${paramName}=${encodeURIComponent(authKey)}&t=${getTimestamp()}`;
    response = await fetch(initUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://ytmp3.gs/',
            'Origin': 'https://ytmp3.gs'
        }
    });
    
    if (!response.ok) {
        throw new Error(`HTTP Error en init: ${response.status} ${await response.text()}`);
    }
    
    const initDataText = await response.text();
    if (!initDataText) throw new Error("Respuesta vacía del servidor en Init");
    const initData = JSON.parse(initDataText);
    
    if (initData.error && Number(initData.error) > 0) {
        throw new Error(`Error inicializando (${initData.error})`);
    }
    
    let currentConvertUrl = initData.convertURL;
    if (!currentConvertUrl) throw new Error("No se obtuvo la URL de conversión.");
    
    let downloadData = null;
    while (true) {
        const cUrl = `${currentConvertUrl}&v=${videoId}&f=${format}&t=${getTimestamp()}`;
        response = await fetch(cUrl);
        const cData = await response.json();
        
        if (cData.error && Number(cData.error) > 0) throw new Error(`Backend Error (Código ${cData.error})`);
        
        if (cData.redirect === 1 && cData.redirectURL) {
            currentConvertUrl = cData.redirectURL;
            continue;
        }
        
        downloadData = cData;
        break;
    }
    
    let progressUrl = downloadData.progressURL;
    let finalDownloadUrl = downloadData.downloadURL;
    let title = downloadData.title || "video";
    
    let isCompleted = false;
    let retryCount = 0;
    
    while (!isCompleted && retryCount < 30) {
        const pUrl = `${progressUrl}&t=${getTimestamp()}`;
        response = await fetch(pUrl);
        const pData = await response.json();
        
        if (pData.error && Number(pData.error) > 0) throw new Error(`Progress Error (Código ${pData.error})`);
        
        if (pData.title) title = pData.title;
        
        if (pData.progress === 3) {
            isCompleted = true;
            break;
        }
        
        await sleep(3000);
        retryCount++;
    }
    
    if (!isCompleted) throw new Error("Tiempo de espera agotado al convertir el video.");
    
    const finalUrl = `${finalDownloadUrl}&s=2&v=${videoId}&f=${format}`;
    
    return {
        status: "success",
        title: title,
        videoId: videoId,
        format: format,
        downloadUrl: finalUrl
    };
}