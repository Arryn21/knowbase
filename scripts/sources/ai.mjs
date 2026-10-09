import { gatherFeeds, dedupeSort, interleave, clip } from '../lib/feeds.mjs';
import { fetchJSON, githubHeaders } from '../lib/http.mjs';
import { gnews } from './news.mjs';

const compact = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n ?? 0);

export async function ai_news() {
  const { items, errors } = await gatherFeeds([
    [gnews('Anthropic OR "Claude AI" when:2d'), 'Google News', 12],
    [gnews('OpenAI OR ChatGPT when:2d'), 'Google News', 12],
    [gnews('"open-weight" OR "open weights" OR "open source model" LLM when:3d'), 'Google News', 10],
    ['https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', 'The Verge'],
    ['https://techcrunch.com/category/artificial-intelligence/feed/', 'TechCrunch'],
    ['https://openai.com/news/rss.xml', 'OpenAI', 6],
    ['https://deepmind.google/blog/rss.xml', 'Google DeepMind', 6],
    ['https://www.reddit.com/r/LocalLLaMA/top/.rss?t=day', 'r/LocalLLaMA', 10],
  ]);
  return { items: interleave(dedupeSort(items, 200, { maxAgeHours: 72 }), 50), errors };
}

export async function hf_trending() {
  const [models, spaces] = await Promise.all([
    fetchJSON('https://huggingface.co/api/models?sort=trendingScore&limit=25'),
    fetchJSON('https://huggingface.co/api/spaces?sort=trendingScore&limit=10'),
  ]);
  const items = [
    ...models.map((m) => ({
      title: m.id,
      url: `https://huggingface.co/${m.id}`,
      source: m.pipeline_tag || 'model',
      time: m.createdAt || null,
      badge: `♥ ${compact(m.likes)}`,
      meta: m.downloads ? `${compact(m.downloads)} downloads` : '',
    })),
    ...spaces.map((s) => ({
      title: s.id,
      url: `https://huggingface.co/spaces/${s.id}`,
      source: 'space',
      time: s.createdAt || null,
      badge: `♥ ${compact(s.likes)}`,
      meta: s.sdk ? `${s.sdk} space` : 'space',
    })),
  ];
  return { items };
}

export async function new_models() {
  const { data } = await fetchJSON('https://openrouter.ai/api/v1/models');
  const perM = (p) => (p == null ? null : Number(p) * 1e6);
  const fmt = (v) => (v == null || v < 0 ? '?' : v === 0 ? '0' : v < 1 ? v.toFixed(2) : v.toFixed(v < 10 ? 2 : 1));
  const items = data
    .filter((m) => m.created)
    .sort((a, b) => b.created - a.created)
    .slice(0, 40)
    .map((m) => {
      const inP = perM(m.pricing?.prompt);
      const outP = perM(m.pricing?.completion);
      const free = inP === 0 && outP === 0;
      return {
        title: m.name || m.id,
        url: `https://openrouter.ai/${m.id}`,
        source: m.id.split('/')[0],
        time: new Date(m.created * 1000).toISOString(),
        badge: free ? 'FREE' : `$${fmt(inP)} / $${fmt(outP)}`,
        meta: `${m.context_length ? compact(m.context_length) + ' ctx' : ''}${free ? '' : ' · per 1M in/out'}`,
        summary: clip(m.description, 160),
      };
    });
  return { items };
}

const RELEASE_REPOS = [
  'anthropics/claude-code',
  'anthropics/anthropic-sdk-python',
  'anthropics/anthropic-sdk-typescript',
  'openai/openai-python',
  'openai/codex',
  'ggml-org/llama.cpp',
  'ollama/ollama',
  'vllm-project/vllm',
  'huggingface/transformers',
  'modelcontextprotocol/modelcontextprotocol',
  'lmstudio-ai/lms',
  'unslothai/unsloth',
  'langchain-ai/langgraph',
  'microsoft/markitdown',
];

export async function releases() {
  const errors = [];
  const lists = await Promise.all(
    RELEASE_REPOS.map(async (repo) => {
      try {
        const rel = await fetchJSON(`https://api.github.com/repos/${repo}/releases?per_page=3`, {
          headers: githubHeaders(),
        });
        return rel
          .filter((r) => !r.draft)
          .map((r) => ({
            title: `${repo.split('/')[1]} ${r.tag_name}`,
            url: r.html_url,
            source: repo,
            time: r.published_at,
            badge: r.prerelease ? 'pre' : '',
            image: `https://opengraph.githubassets.com/1/${repo}`,
            summary: clip(r.name && r.name !== r.tag_name ? r.name : r.body || '', 140),
          }));
      } catch (err) {
        errors.push(`${repo}: ${err.message}`);
        return [];
      }
    }),
  );
  return { items: dedupeSort(lists.flat(), 40), errors };
}

export async function research() {
  const papers = await fetchJSON('https://huggingface.co/api/daily_papers?limit=40').catch(() => []);
  const hf = papers.map((p) => ({
    title: p.title || p.paper?.title,
    url: `https://huggingface.co/papers/${p.paper?.id}`,
    source: 'HF Daily Papers',
    time: p.publishedAt || p.paper?.publishedAt || null,
    badge: p.paper?.upvotes ? `▲ ${p.paper.upvotes}` : '',
    summary: clip(p.paper?.ai_summary || p.summary || p.paper?.summary, 200),
    score: p.paper?.upvotes || 0,
    image: p.thumbnail || null,
  }));
  hf.sort((a, b) => b.score - a.score);
  const { items: arxiv, errors } = await gatherFeeds([
    ['https://rss.arxiv.org/rss/cs.CR', 'arXiv cs.CR', 12],
    ['https://rss.arxiv.org/rss/cs.NI', 'arXiv cs.NI', 6],
  ]);
  arxiv.forEach((a) => (a.summary = clip(a.summary.replace(/^arXiv:\S+\s+Announce Type:\s*\w+\s*Abstract:\s*/i, ''), 200)));
  return { items: [...hf.slice(0, 30), ...dedupeSort(arxiv, 18)], errors };
}

export async function techniques() {
  const { items, errors } = await gatherFeeds([
    ['https://simonwillison.net/atom/everything/', 'Simon Willison', 10],
    ['https://portswigger.net/research/rss', 'PortSwigger Research', 6],
    ['https://blog.trailofbits.com/feed/', 'Trail of Bits', 6],
    ['https://googleprojectzero.blogspot.com/feeds/posts/default', 'Project Zero', 5],
    ['https://lilianweng.github.io/index.xml', "Lil'Log", 4],
    ['https://magazine.sebastianraschka.com/feed', 'Ahead of AI', 5],
    ['https://huggingface.co/blog/feed.xml', 'Hugging Face', 6],
  ]);
  return { items: interleave(dedupeSort(items, 100), 40), errors };
}
