import { gatherFeeds, dedupeSort, interleave } from '../lib/feeds.mjs';
import { fetchJSON } from '../lib/http.mjs';

export async function chess_news() {
  const { items, errors } = await gatherFeeds([
    ['https://en.chessbase.com/feed', 'ChessBase', 15],
    ['https://www.chess.com/rss/news', 'Chess.com', 15],
    ['https://www.fide.com/rss', 'FIDE', 8],
    ['https://www.reddit.com/r/chess/top/.rss?t=day', 'r/chess', 10],
  ]);
  items.forEach((i) => i.source === 'r/chess' && (i.summary = ''));
  return { items: interleave(dedupeSort(items, 120, { maxAgeHours: 240 }), 40), errors };
}

// Lessons, opening ideas, study tips.
export async function chess_learn() {
  const { items, errors } = await gatherFeeds([
    ['https://www.chess.com/rss/articles', 'Chess.com articles', 20],
    ['https://lichess.org/@/lichess/blog.atom', 'Lichess blog', 10],
  ]);
  return { items: interleave(dedupeSort(items, 60), 30), errors };
}

export async function chess_live() {
  const j = await fetchJSON('https://lichess.org/api/broadcast/top?page=1');
  const toItem = (b, live) => ({
    title: b.tour.name,
    url: b.round?.url || b.tour.url,
    source: b.tour.info?.location || 'Broadcast',
    time: b.round?.startsAt ? new Date(b.round.startsAt).toISOString() : null,
    badge: live && b.round?.ongoing ? 'LIVE' : b.round?.name || '',
    meta: [b.tour.info?.format, b.tour.info?.fideTC].filter(Boolean).join(' · '),
    upcoming: true,
    tier: b.tour.tier || 0,
    image: b.tour.image || null,
  });
  const items = [
    ...(j.active || []).map((b) => toItem(b, true)),
    ...(j.upcoming || []).map((b) => toItem(b, false)),
  ]
    // Ongoing rounds first, then the highest-tier events.
    .sort((a, b) => (b.badge === 'LIVE') - (a.badge === 'LIVE') || b.tier - a.tier)
    .slice(0, 30);
  return { items };
}

export async function chess_puzzle() {
  const errors = [];
  let lichess = null;
  let chesscom = null;
  try {
    const { puzzle, game } = await fetchJSON('https://lichess.org/api/puzzle/daily');
    lichess = {
      id: puzzle.id,
      url: `https://lichess.org/training/${puzzle.id}`,
      fen: puzzle.fen,
      lastMove: puzzle.lastMove,
      solution: puzzle.solution,
      rating: puzzle.rating,
      themes: puzzle.themes,
      perf: game?.perf?.name,
    };
  } catch (err) {
    errors.push(`Lichess puzzle: ${err.message}`);
  }
  try {
    const p = await fetchJSON('https://api.chess.com/pub/puzzle');
    chesscom = { title: p.title, url: p.url, image: p.image, fen: p.fen };
  } catch (err) {
    errors.push(`Chess.com puzzle: ${err.message}`);
  }
  if (!lichess && !chesscom) throw new Error(errors.join('; '));
  return { items: [], lichess, chesscom, errors };
}
