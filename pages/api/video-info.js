import { extractVideoId } from '../../utils/transcript'

export default async function handler(req, res) {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url required' })

  const videoId = extractVideoId(url)
  if (!videoId) return res.status(400).json({ error: 'Invalid URL' })

  try {
    const { Innertube } = await import('youtubei.js')
    const yt = await Innertube.create({ generate_session_locally: true })
    const info = await yt.getBasicInfo(videoId)
    const duration = info.basic_info?.duration ?? null
    const title = info.basic_info?.title ?? null
    return res.json({ duration, title, videoId })
  } catch (err) {
    // Non-fatal — frontend handles null gracefully
    return res.json({ duration: null, title: null, videoId })
  }
}
