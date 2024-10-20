const {
  extractYoutube,
  extractFromYtdlCore,
  extractFromInvidious,
  extractFromBeatbump,
  extractFromAlltube249,
  extractFromAlltube250,
  extractFromAlltube251,
  extractFromYoutubeRaw,
} = require("../../helper/extractYoutube");
const memoryClient = require("../../lib/cache/memory");
const httpProxy = require("http-proxy");
const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  ignorePath: true,
  secure: false,
  followRedirects: true,
});

const {
  create_return_error,
  objectIsEmpty,
} = require("../../helper/functions");
const asyncAsync = require("async");

const audioServers = [
  {
    function: extractFromYoutubeRaw,
    name: "extractFromYoutubeRaw",
    isActive: true,
  },
  {
    function: extractFromInvidious,
    name: "extractFromInvidious",
    isActive: true,
  },
  {
    function: extractFromYtdlCore,
    name: "extractFromYtdlCore",
    isActive: true,
  },
  {
    function: extractFromBeatbump,
    name: "extractFromBeatbump",
    isActive: true,
  },
  {
    function: extractFromAlltube251,
    name: "extractFromAlltube251",
    isActive: true,
  },
  {
    function: extractFromAlltube250,
    name: "extractFromAlltube250",
    isActive: true,
  },
  {
    function: extractFromAlltube249,
    name: "extractFromAlltube249",
    isActive: true,
  },
  { function: extractYoutube, name: "extractYoutube", isActive: true },
];

let currentServerIndex = 0;

const getNextActiveServer = () => {
  const startIndex = currentServerIndex;
  do {
    currentServerIndex = (currentServerIndex + 1) % audioServers.length;
    if (audioServers[currentServerIndex].isActive) {
      console.log(
        `Changing audio server to: ${audioServers[currentServerIndex].name}`,
      );
      return audioServers[currentServerIndex];
    }
  } while (currentServerIndex !== startIndex);

  throw new Error("No active audio servers available");
};

const getAudioFromYt = async (id) => {
  try {
    const audio = await audioServers[currentServerIndex].function(id, "audio");
    if (!audio || objectIsEmpty(audio)) {
      throw create_return_error("No audio found", 404);
    }
    return audio;
  } catch (error) {
    console.error(
      `Error with server ${audioServers[currentServerIndex].name}:`,
      error,
    );
    audioServers[currentServerIndex].isActive = false;
    getNextActiveServer();
    throw error;
  }
};

// REAL AUDIO FUNC
exports.getAudio = async (req, res, next) => {
  const { id } = req.query;
  try {
    return asyncAsync.retry(
      7,
      getAudioFromYt.bind(null, id),
      async function (err, result) {
        if (err) {
          return next(err);
        }
        const audio = result;
        await memoryClient.set(`/audio`, id, audio, 2); // 2 hour cache

        const container =
          audio?.container || "webm_dash" || "mp3" || "webm" || "mp4a";
        const mimeType =
          audio?.mimeType || audio?.type || 'audio/webm; codecs="opus"';

        // Set headers for the response
        res.setHeader(
          "Content-disposition",
          `inline; filename=${id}.${container}`,
        );
        res.setHeader("Content-type", mimeType);

        // Set headers for the proxy request
        const proxyReq = {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            Origin: "https://music.youtube.com",
            Referer: "https://music.youtube.com/",
          },
        };

        if (process.env.NODE_ENV != "production") {
          console.info("audio", audio?.url || audio, proxyReq.headers);
        }

        // Use the proxy to forward the request
        proxy.web(req, res, {
          target: audio?.url || audio,
          headers: proxyReq.headers,
        });
      },
    );
  } catch (error) {
    console.error(error);
    next(error);
  }
};

// Add an error handler for the proxy
proxy.on("error", (err, req, res) => {
  console.error("Proxy error:", err);
  res.writeHead(500, {
    "Content-Type": "text/plain",
  });
  res.end("Something went wrong with the proxy.");
});

exports.changeAudioServer = async (req, res, next) => {
  const { s, key } = req.query;

  try {
    if (key !== process.env.CHANGE_COOKIE_KEY) {
      throw create_return_error("Unauthorized access", 403);
    }

    const serverIndex = audioServers.findIndex((server) => server.name === s);
    if (serverIndex === -1) {
      throw create_return_error("Server not found", 404);
    }

    currentServerIndex = serverIndex;
    console.log(
      `Manually changed audio server to: ${audioServers[currentServerIndex].name}`,
    );

    return res.json({ currentServer: audioServers[currentServerIndex] });
  } catch (error) {
    next(error);
  }
};

exports.getServerStatus = async (req, res, next) => {
  try {
    const testId = "dQw4w9WgXcQ"; // Use a reliable video ID for testing

    const serverStatuses = await Promise.all(
      audioServers.map(async (server) => {
        try {
          await server.function(testId, "audio");
          return { name: server.name, isActive: true };
        } catch (error) {
          console.error(`Error testing ${server.name}:`, error);
          return { name: server.name, isActive: false };
        }
      }),
    );

    // Update the main audioServers array with the new statuses
    serverStatuses.forEach((status, index) => {
      audioServers[index].isActive = status.isActive;
    });

    return res.json({
      currentServer: audioServers[currentServerIndex].name,
      servers: serverStatuses,
    });
  } catch (error) {
    next(error);
  }
};

exports.audioDownload = async (req, res, next) => {
  let { id, title } = req.query;
  // try {
  //   const cache = await memoryClient.get(`/audio`, id);

  //   let audio;
  //   if (cache) {
  //     audio = cache;
  //   } else {
  //     audio = await extractYoutube(id, "audio");
  //   }

  //   if (!audio || (audio && objectIsEmpty(audio))) {
  //     // next(create_return_error("No audio found", 404));
  //   }

  //   res.setHeader(
  //     "Content-disposition",
  //     `attachment; filename=${title.trim() || id}.mp3`
  //   );
  //   // res.setHeader('Content-disposition', 'attachment; filename=videoplayback.'+audio.container);
  //   res.setHeader("Content-type", audio.mimeType || "audio/mp3");

  //   //    return https.get(audio, (response) => {
  //   //      response.pipe(res)
  //   //    })

  //   if (!cache) await memoryClient.set(`/audio`, id, audio, 2); // 2 hour

  //   return proxy.web(req, res, {
  //     target: audio?.url || audio,
  //     changeOrigin: true,
  //   });
  // } catch (error) {
  //   console.error(error);
  //   // next(error);
  //   let status = error?.status || 404;
  //   const stderr = error?.stderr;
  //   let msg;
  //   if (stderr) {
  //     const errorTextInd = stderr.indexOf("ERROR");
  //     msg = stderr.substr(errorTextInd);
  //     const newLineInd = msg.indexOf("\n");
  //     msg = msg.substr(0, newLineInd);
  //   }

  //   // await memoryClient.set(`/audio`, id, false, 0); // 0 hour

  //   // const message = error?.stderr.substr();
  //   return res.status(status).json(msg ? { message: msg } : error);
  // }

  try {
    const cache = false;
    // await memoryClient.get(`/audio`, id);

    if (cache) {
      audio = cache;
      if (!audio || (audio && objectIsEmpty(audio))) {
        next(create_return_error("No audio found", 404));
      }

      const container =
        audio?.container || "webm_dash" || "mp3" || "webm" || "mp4a";

      const mimeType =
        audio?.mimeType || audio?.type || 'audio/webm; codecs="opus"';
      res.setHeader(
        "Content-disposition",
        `attachment; filename=${title.trim() || id}.mp3`,
      );
      res.setHeader("Content-type", mimeType);

      return proxy.web(req, res, {
        target: audio?.url || audio,
        changeOrigin: true,
      });
    } else {
      return asyncAsync.retry(
        7,
        getAudioFromYt.bind(null, id),
        async function (err, result) {
          try {
            if (err) {
              console.log(err);
              throw err;
            }

            audio = result;

            if (!audio || (audio && objectIsEmpty(audio))) {
              throw create_return_error("No audio found", 404);
            }

            await memoryClient.set(`/audio`, id, audio, 2); // 2 hour

            const container =
              audio?.container || "webm_dash" || "mp3" || "webm" || "mp4a";

            const mimeType =
              audio?.mimeType || audio?.type || 'audio/webm; codecs="opus"';
            res.setHeader(
              "Content-disposition",
              `attachment; filename=${title.trim() || id}.mp3`,
            );
            res.setHeader("Content-type", mimeType);

            const final = audio?.url || audio;
            console.info("audio", final);
            return proxy.web(req, res, {
              target: final,
              changeOrigin: true,
            });
          } catch (error) {
            next(err);
          }
        },
      );
    }
  } catch (error) {
    // await memoryClient.set(`/audio`, id, false, 0); // 0 hour
    // const message = error?.stderr.substr();
    // return res.json(error);
    next(error);
  }
};

exports.getNextSongs = async (req, res, next) => {
  const { id, params, playlistId, idx, continuation } = req.query;

  try {
    const cache = await memoryClient.get(
      `/nextSongs`,
      id + params + playlistId + idx + continuation,
    );

    if (cache) {
      return res.json(cache);
    }

    const result = await YtMusic.next_songs(
      id,
      params,
      playlistId,
      idx,
      continuation,
    );

    // if (continuation) {
    //   return res.json(result);
    // }
    // error handling
    if (
      !continuation &&
      (!result ||
        (result &&
          objectIsEmpty(
            result?.contents?.singleColumnMusicWatchNextResultsRenderer,
          )))
    ) {
      next(create_return_error("No result found", 404));
    }

    let songData = Parser.singleColumnMusicWatchNextResultsRenderer(
      result.contents.singleColumnMusicWatchNextResultsRenderer,
    );

    songData.currentVideoEndpoint =
      result?.currentVideoEndpoint &&
      Parser.findNavigationEndpoint({
        navigationEndpoint: result.currentVideoEndpoint,
      });

    // error handling
    if (
      !continuation &&
      (!songData || (songData && objectIsEmpty(songData?.next_songs?.list)))
    ) {
      next(create_return_error("No result found", 404));
    }

    // * development only
    let status = 200;
    if (
      !continuation &&
      ((songData && songData.next_songs.list?.list?.length <= 0) ||
        !songData.next_songs.list?.title)
    ) {
      // return res.json(result);
      // List is empty
      songData.hack = true;
      songData.message = "Up next list is empty.";
      // status = 204;
    }

    if (
      (continuation && !result?.continuationContents) ||
      (result?.continuationContents &&
        objectIsEmpty(result?.continuationContents))
    ) {
      next(create_return_error("No result found", 404));
    }

    if (continuation) {
      songData.next_songs.list = Parser.continuationContents(
        result.continuationContents,
        false,
        true,
      );
    }

    await memoryClient.set(
      `/nextSongs`,
      id + params + playlistId + idx + continuation,
      songData,
      4,
    ); // 2 hour

    return res.status(status).json(songData);
  } catch (error) {
    next(error);
  }
};

exports.getQueue = async (req, res, next) => {
  const { videoIds, playlistId } = req.body;

  try {
    if (videoIds?.length === 0 && !playlistId) {
      create_return_error("INVALID ID", 404);
    }

    const memoid = videoIds?.join("") || "";

    const cache = await memoryClient.get(`/queue`, memoid + playlistId);

    if (cache) {
      return res.json(cache);
    }

    const result = await YtMusic.get_queue(videoIds, playlistId);

    // error handling
    if (!result || (result && result?.queueDatas?.length <= 0)) {
      next(create_return_error("Unable to add to queue", 404));
    }

    const final = { queue: [] };

    for (let item of result?.queueDatas) {
      const playlistPanelVideoRenderer =
        item?.content?.playlistPanelVideoRenderer;
      if (playlistPanelVideoRenderer) {
        final.queue.push(
          Parser.playlistPanelVideoRenderer(playlistPanelVideoRenderer),
        );
      }
    }

    final.queue = final.queue.slice(0, 40);

    await memoryClient.set(`/queue`, memoid + playlistId, final, 4); // 4 hour

    return res.json(final);
  } catch (error) {
    next(error);
  }
};

exports.changeAudioServer = async (req, res, next) => {
  let { s, key } = req.query;

  try {
    if (key !== process.env.CHANGE_COOKIE_KEY) {
      throw create_return_error("Fuck Off!");
    }

    const server = audioServers.find((ser) => ser.name === s);
    if (!server) {
      throw create_return_error("Server not found!");
    }

    const totalServers = audioServers.length;

    for (let i = 0; i < totalServers; i++) {
      if (audioServers[i].name === s) {
        audioServers[i].isSelected = true;
      } else {
        audioServers[i].isSelected = false;
      }
    }

    return res.json({ updatedServers: audioServers });
  } catch (error) {
    next(error);
  }
};
