import { TwitterApi } from "twitter-api-v2";

export interface FetchedTweet {
  xPostId: string;
  authorHandle: string;
  authorName: string;
  authorFollowers: number;
  authorAvatarUrl?: string;
  text: string;
  likeCount: number;
  retweetCount: number;
  postedAt: Date;
  /** Raw signal from the source that this is sponsored content, when the API exposes one. */
  isAdLabelled?: boolean;
}

function hasCredentials(): boolean {
  return Boolean(
    process.env.X_API_KEY &&
      process.env.X_API_SECRET &&
      process.env.X_ACCESS_TOKEN &&
      process.env.X_ACCESS_SECRET,
  );
}

export function isMockMode(): boolean {
  return !hasCredentials();
}

function getClient(): TwitterApi {
  return new TwitterApi({
    appKey: process.env.X_API_KEY!,
    appSecret: process.env.X_API_SECRET!,
    accessToken: process.env.X_ACCESS_TOKEN!,
    accessSecret: process.env.X_ACCESS_SECRET!,
  });
}

/**
 * Fetches candidate "buzzing" posts for the given genre keywords.
 * Falls back to fixture data when X API credentials are not configured
 * (see spec/README.md ステップ1) so the app is runnable/demoable before
 * a developer account is provisioned.
 */
export async function fetchBuzzPosts(
  keywords: string[],
  count: number,
): Promise<FetchedTweet[]> {
  if (isMockMode()) {
    return mockFetchBuzzPosts(keywords, count);
  }

  const client = getClient().readOnly;
  const query = `(${keywords.join(" OR ")}) -is:retweet lang:ja`;
  const result = await client.v2.search(query, {
    max_results: Math.min(Math.max(count, 10), 100),
    "tweet.fields": ["created_at", "public_metrics", "author_id"],
    expansions: ["author_id"],
    "user.fields": ["username", "name", "public_metrics", "profile_image_url"],
  });

  const users = new Map(result.includes?.users?.map((u) => [u.id, u]) ?? []);
  const tweets: FetchedTweet[] = [];
  for (const tweet of result.data?.data ?? []) {
    const author = users.get(tweet.author_id ?? "");
    tweets.push({
      xPostId: tweet.id,
      authorHandle: author?.username ?? "unknown",
      authorName: author?.name ?? "unknown",
      authorFollowers: author?.public_metrics?.followers_count ?? 0,
      authorAvatarUrl: author?.profile_image_url,
      text: tweet.text,
      likeCount: tweet.public_metrics?.like_count ?? 0,
      retweetCount: tweet.public_metrics?.retweet_count ?? 0,
      postedAt: new Date(tweet.created_at ?? Date.now()),
    });
  }
  return tweets.slice(0, count);
}

export async function postReply(
  tweetId: string,
  text: string,
): Promise<string> {
  if (isMockMode()) {
    return mockPost();
  }
  const client = getClient().readWrite;
  const { data } = await client.v2.reply(text, tweetId);
  return data.id;
}

export async function postQuoteTweet(
  tweetId: string,
  text: string,
): Promise<string> {
  if (isMockMode()) {
    return mockPost();
  }
  const client = getClient().readWrite;
  const { data } = await client.v2.tweet({
    text,
    quote_tweet_id: tweetId,
  });
  return data.id;
}

export async function postOriginalTweet(text: string): Promise<string> {
  if (isMockMode()) {
    return mockPost();
  }
  const client = getClient().readWrite;
  const { data } = await client.v2.tweet(text);
  return data.id;
}

function mockPost(): Promise<string> {
  return Promise.resolve(`mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
}

const MOCK_POOL: (Omit<FetchedTweet, "postedAt"> & { hoursAgo: number })[] = [
  {
    xPostId: "mock-1",
    authorHandle: "startup_taro",
    authorName: "太郎|起業3年目",
    authorFollowers: 42000,
    text: "起業して3年、売上より先に「毎朝迷わず動けるか」の方が大事だと気づいた。判断疲れが一番の敵。",
    likeCount: 3200,
    retweetCount: 410,
    hoursAgo: 1.5,
  },
  {
    xPostId: "mock-2",
    authorHandle: "sns_hack_jiro",
    authorName: "次郎@SNS運用コンサル",
    authorFollowers: 180000,
    text: "フォロワー10万人までにやったことで一番効いたのは「毎日同じ時間に投稿する」だけ。テクニックより継続。",
    likeCount: 9800,
    retweetCount: 1200,
    hoursAgo: 3,
  },
  {
    xPostId: "mock-3",
    authorHandle: "marketer_hana",
    authorName: "花|マーケター",
    authorFollowers: 8500,
    text: "新規事業の立ち上げに失敗した。原因は市場調査不足じゃなくて、誰にも相談せず一人で突っ走ったこと。",
    likeCount: 1500,
    retweetCount: 210,
    hoursAgo: 4,
  },
  {
    xPostId: "mock-4",
    authorHandle: "meme_account_x",
    authorName: "ネタ垢",
    authorFollowers: 250000,
    text: "経営者「朝4時起きが最強」→ワイ「朝4時まで起きてるのが最強」",
    likeCount: 22000,
    retweetCount: 5400,
    hoursAgo: 2,
  },
  {
    xPostId: "mock-5",
    authorHandle: "pr_official_brand",
    authorName: "〇〇株式会社【広告】",
    authorFollowers: 15000,
    text: "【PR】今だけ無料相談実施中!このツールを使えば誰でも簡単に売上UP、詳しくはプロフィールのリンクから。",
    likeCount: 300,
    retweetCount: 40,
    hoursAgo: 2,
    isAdLabelled: true,
  },
];

function mockFetchBuzzPosts(
  _keywords: string[],
  count: number,
): Promise<FetchedTweet[]> {
  const now = Date.now();
  const shuffled = [...MOCK_POOL].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, Math.min(count, shuffled.length));
  return Promise.resolve(
    picked.map(({ hoursAgo, ...rest }) => ({
      ...rest,
      postedAt: new Date(now - hoursAgo * 3600 * 1000),
    })),
  );
}
