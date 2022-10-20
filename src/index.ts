import "dotenv/config"
import { filter, map, Subscription } from "rxjs"
import { createBluOsStatusObservable, PlayingTrack } from "./bluOs.js"
import { obtainSessionToken } from "./session.js"
import { scrobbleTrack, updateNowPlaying } from "./submitTrack.js"
import { pino } from "pino"

const subscriptions = await createScrobbler()

process
  .once("SIGINT", shutdown)
  .once("SIGTERM", shutdown)
  .once("uncaughtException", handleUncaughtError)

async function createScrobbler(): Promise<Subscription> {
  const logger = pino(
    {
      level: process.env["LOG_LEVEL"] ?? "info",
      name: "blu-hawaii",
    },
    pino.destination("./logs/blu-hawaii.log"),
  )

  const bluOsConfig = {
    ip: process.env["BLUOS_IP"]!!,
    port: process.env["BLUOS_PORT"]!!,
    logger: logger.child({ component: "bluOS" }),
  }

  const lastFmConfig = {
    apiKey: process.env["LAST_FM_API_KEY"]!!,
    apiSecret: process.env["LAST_FM_API_SECRET"]!!,
    logger: logger.child({ component: "lastFm" }),
  }

  const sessionToken = await obtainSessionToken(lastFmConfig)

  if (!sessionToken) {
    logger.error({ error: "Unable to obtain session!" })
    process.exit(1)
  }

  const bluOsStatus = createBluOsStatusObservable(bluOsConfig)

  const playingTrack = bluOsStatus.pipe(
    map((s) => s.playingTrack),
    filter((t): t is PlayingTrack => t !== undefined),
  )

  const updatedNowPlayingTrack = updateNowPlaying(
    lastFmConfig,
    sessionToken,
    playingTrack,
  )

  const scrobbledTrack = scrobbleTrack(lastFmConfig, sessionToken, playingTrack)

  const subscriptions = updatedNowPlayingTrack.subscribe((response) => {
    logger.info({ updatedNowPlaying: response })
  })

  subscriptions.add(
    scrobbledTrack.subscribe((scrobbleResponse) => {
      logger.info({ scrobble: scrobbleResponse })
    }),
  )

  return subscriptions
}

function handleUncaughtError(err: unknown, origin: string) {
  console.error(`Caught unknown error from ${origin}...`)
  console.error((err as Error).stack || err)
  shutdown("error")
}

function shutdown(signal: string) {
  console.log(`Caught ${signal}, cleaning and waiting timeout...`)
  subscriptions.unsubscribe()
  setTimeout(() => {
    console.log("...Done!")
    process.exit()
  }, 5000).unref()
}
