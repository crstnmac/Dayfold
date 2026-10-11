import type { Adapter, FocusContext } from './types'

const titleBefore = (title: string, sep: RegExp): string => title.split(sep)[0]?.trim() ?? ''

const pathKind =
  (rules: [RegExp, string][], fallback = 'browsing') =>
  (ctx: FocusContext): { kind: string } => ({
    kind: rules.find(([re]) => re.test(ctx.path))?.[1] ?? fallback
  })

/** Gmail titles: "Inbox (3) - me@x.com - Gmail", "Subject - me@x.com - Gmail", "Compose..." */
const gmail: Adapter['describe'] = (ctx) => {
  const first = titleBefore(ctx.title, / - /)
  const hash = ctx.path
  if (/compose|^New Message/i.test(ctx.title) || /compose=/.test(ctx.url))
    return { kind: 'composing' }
  if (/^(Inbox|Starred|Sent|Drafts|All Mail|Spam|Trash|Snoozed|Important|Scheduled)\b/i.test(first))
    return { kind: 'triaging', detail: first.replace(/\s*\(\d+\)\s*$/, '') }
  if (/^Search results\b/i.test(first)) return { kind: 'searching' }
  return hash === '/' || !first ? { kind: 'triaging' } : { kind: 'reading', detail: first }
}

const slack: Adapter['describe'] = (ctx) => {
  // "name (channel) - Workspace - Slack", "Activity - Workspace - Slack"
  const parts = ctx.title.split(' - ')
  const first = parts[0]?.trim() ?? ''
  if (/^(Activity|Later|DMs|Files|Huddles|Home)\b/i.test(first)) return { kind: 'triaging' }
  if (/\(DM\)|\(direct message\)/i.test(first)) return { kind: 'messaging', detail: first }
  return { kind: 'messaging', detail: first }
}

export const ADAPTERS: Adapter[] = [
  // ───────── Email
  { id: 'gmail', name: 'Gmail', category: 'email', hosts: ['mail.google.com'], describe: gmail },
  {
    id: 'outlook-web',
    name: 'Outlook (web)',
    category: 'email',
    hosts: ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com'],
    describe: pathKind(
      [
        [/\/mail\/(compose|deeplink\/compose)/i, 'composing'],
        [/\/mail\//i, 'reading'],
        [/\/calendar/i, 'scheduling']
      ],
      'working'
    )
  },
  {
    id: 'yahoo-mail',
    name: 'Yahoo Mail',
    category: 'email',
    hosts: ['mail.yahoo.com'],
    describe: pathKind([[/compose/, 'composing']], 'reading')
  },
  {
    id: 'proton-mail',
    name: 'Proton Mail',
    category: 'email',
    hosts: ['mail.proton.me', 'mail.protonmail.com'],
    describe: pathKind([[/compose/, 'composing']], 'reading')
  },
  {
    id: 'icloud',
    name: 'iCloud',
    category: 'other',
    hosts: ['=www.icloud.com', '=icloud.com'],
    describe: pathKind([[/^\/mail/, 'reading']], 'using')
  },
  { id: 'fastmail', name: 'Fastmail', category: 'email', hosts: ['app.fastmail.com'] },
  { id: 'hey', name: 'HEY', category: 'email', hosts: ['app.hey.com'] },
  {
    id: 'apple-mail',
    name: 'Apple Mail',
    category: 'email',
    bundleIds: ['com.apple.mail'],
    describe: (c) =>
      /^New Message|^Re:|^Fwd:/i.test(c.title)
        ? { kind: 'composing' }
        : { kind: 'reading', detail: titleBefore(c.title, / [—–-] /) }
  },
  {
    id: 'outlook',
    name: 'Outlook',
    category: 'email',
    bundleIds: ['com.microsoft.Outlook'],
    describe: (c) =>
      /^(New|Untitled|Re:|Fwd:)/i.test(c.title) ? { kind: 'composing' } : { kind: 'reading' }
  },
  { id: 'spark', name: 'Spark', category: 'email', bundleIds: ['com.readdle.smartemail-Mac'] },
  {
    id: 'superhuman',
    name: 'Superhuman',
    category: 'email',
    bundleIds: ['com.superhuman.electron']
  },
  {
    id: 'mimestream',
    name: 'Mimestream',
    category: 'email',
    bundleIds: ['com.mimestream.Mimestream']
  },

  // ───────── Messaging
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    category: 'messaging',
    bundleIds: ['net.whatsapp.WhatsApp', 'desktop.WhatsApp'],
    hosts: ['web.whatsapp.com'],
    describe: (c) => {
      // WhatsApp titles are usually just "WhatsApp"; a "(n) WhatsApp" prefix carries unread count.
      const chat = c.title
        .replace(/^\(\d+\)\s*/, '')
        .replace(/\s*[-–—|]\s*WhatsApp.*$/i, '')
        .trim()
      return { kind: 'messaging', detail: /^whatsapp$/i.test(chat) ? '' : chat }
    }
  },
  {
    id: 'telegram',
    name: 'Telegram',
    category: 'messaging',
    bundleIds: ['ru.keepcoder.Telegram', 'org.telegram.desktop'],
    hosts: ['web.telegram.org'],
    describe: (c) => ({ kind: 'messaging', detail: c.title.replace(/^Telegram\s*[-–—]?\s*/i, '') })
  },
  {
    id: 'signal',
    name: 'Signal',
    category: 'messaging',
    bundleIds: ['org.whispersystems.signal-desktop'],
    describe: () => ({ kind: 'messaging' })
  },
  {
    id: 'imessage',
    name: 'Messages',
    category: 'messaging',
    bundleIds: ['com.apple.MobileSMS'],
    describe: (c) => ({ kind: 'messaging', detail: c.title })
  },
  {
    id: 'messenger',
    name: 'Messenger',
    category: 'messaging',
    bundleIds: ['com.facebook.archon'],
    hosts: ['messenger.com'],
    describe: () => ({ kind: 'messaging' })
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'messaging',
    bundleIds: ['com.tinyspeck.slackmacgap'],
    hosts: ['slack.com'],
    describe: slack
  },
  {
    id: 'discord',
    name: 'Discord',
    category: 'messaging',
    bundleIds: ['com.hnc.Discord'],
    hosts: ['discord.com'],
    describe: (c) => ({
      kind: 'messaging',
      detail: c.title.replace(/^[@#]\s*/, '').replace(/\s*[-|]\s*Discord$/i, '')
    })
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    category: 'messaging',
    bundleIds: ['com.microsoft.teams2', 'com.microsoft.teams'],
    hosts: ['teams.microsoft.com', 'teams.live.com'],
    describe: (c) => (/meeting|call/i.test(c.title) ? { kind: 'in a call' } : { kind: 'messaging' })
  },
  {
    id: 'google-chat',
    name: 'Google Chat',
    category: 'messaging',
    hosts: ['chat.google.com'],
    describe: () => ({ kind: 'messaging' })
  },
  { id: 'line', name: 'LINE', category: 'messaging', bundleIds: ['jp.naver.line.mac'] },
  { id: 'wechat', name: 'WeChat', category: 'messaging', bundleIds: ['com.tencent.xinWeChat'] },

  // ───────── Meetings
  {
    id: 'zoom',
    name: 'Zoom',
    category: 'meeting',
    bundleIds: ['us.zoom.xos'],
    hosts: ['zoom.us'],
    describe: (c) =>
      /^\/(j|wc)\//.test(c.path) || /^Zoom Meeting$/i.test(c.title)
        ? { kind: 'in a call' }
        : { kind: 'using' }
  },
  {
    id: 'google-meet',
    name: 'Google Meet',
    category: 'meeting',
    hosts: ['meet.google.com'],
    describe: pathKind([[/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/, 'in a call']], 'scheduling')
  },
  {
    id: 'facetime',
    name: 'FaceTime',
    category: 'meeting',
    bundleIds: ['com.apple.FaceTime'],
    describe: () => ({ kind: 'in a call' })
  },
  {
    id: 'webex',
    name: 'Webex',
    category: 'meeting',
    bundleIds: ['Cisco-Systems.Spark'],
    hosts: ['webex.com']
  },

  // ───────── Social
  {
    id: 'x',
    name: 'X (Twitter)',
    category: 'social',
    hosts: ['x.com', 'twitter.com'],
    describe: pathKind(
      [
        [/^\/compose/, 'composing'],
        [/^\/messages/, 'messaging'],
        [/^\/notifications/, 'checking notifications'],
        [/^\/home|^\/$/, 'scrolling'],
        [/^\/search|^\/explore/, 'searching'],
        [/\/status\//, 'reading']
      ],
      'browsing'
    )
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    category: 'social',
    hosts: ['linkedin.com'],
    describe: pathKind(
      [
        [/^\/messaging/, 'messaging'],
        [/^\/jobs/, 'job hunting'],
        [/^\/feed/, 'scrolling'],
        [/^\/in\//, 'viewing a profile'],
        [/^\/notifications/, 'checking notifications'],
        [/^\/mynetwork/, 'networking']
      ],
      'browsing'
    )
  },
  {
    id: 'instagram',
    name: 'Instagram',
    category: 'social',
    hosts: ['instagram.com'],
    describe: pathKind(
      [
        [/^\/direct/, 'messaging'],
        [/^\/reels?/, 'watching'],
        [/^\/stories/, 'watching'],
        [/^\/explore/, 'searching'],
        [/^\/$/, 'scrolling']
      ],
      'browsing'
    )
  },
  {
    id: 'facebook',
    name: 'Facebook',
    category: 'social',
    hosts: ['facebook.com', 'fb.com'],
    describe: pathKind(
      [
        [/^\/messages/, 'messaging'],
        [/^\/watch|^\/reel/, 'watching'],
        [/^\/marketplace/, 'shopping'],
        [/^\/groups/, 'in groups'],
        [/^\/$/, 'scrolling']
      ],
      'browsing'
    )
  },
  {
    id: 'threads',
    name: 'Threads',
    category: 'social',
    hosts: ['threads.net', 'threads.com'],
    describe: pathKind([[/^\/$/, 'scrolling']], 'browsing')
  },
  {
    id: 'bluesky',
    name: 'Bluesky',
    category: 'social',
    hosts: ['bsky.app'],
    describe: pathKind(
      [
        [/^\/messages/, 'messaging'],
        [/^\/$/, 'scrolling']
      ],
      'browsing'
    )
  },
  {
    id: 'mastodon',
    name: 'Mastodon',
    category: 'social',
    hosts: ['mastodon.social'],
    describe: pathKind([[/^\/home/, 'scrolling']], 'browsing')
  },
  {
    id: 'reddit',
    name: 'Reddit',
    category: 'social',
    hosts: ['reddit.com'],
    describe: (c) => ({
      kind: /\/comments\//.test(c.path)
        ? 'reading'
        : /^\/submit/.test(c.path)
          ? 'composing'
          : 'scrolling',
      detail: (c.path.match(/^\/r\/([^/]+)/) ?? [])[1] ?? ''
    })
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    category: 'social',
    hosts: ['tiktok.com'],
    describe: () => ({ kind: 'watching' })
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    category: 'social',
    hosts: ['pinterest.com'],
    describe: () => ({ kind: 'scrolling' })
  },
  {
    id: 'snapchat',
    name: 'Snapchat',
    category: 'social',
    hosts: ['web.snapchat.com', 'snapchat.com'],
    describe: () => ({ kind: 'messaging' })
  },
  {
    id: 'hacker-news',
    name: 'Hacker News',
    category: 'social',
    hosts: ['news.ycombinator.com'],
    describe: pathKind([[/^\/item/, 'reading']], 'scrolling')
  },
  {
    id: 'substack',
    name: 'Substack',
    category: 'social',
    hosts: ['substack.com'],
    describe: () => ({ kind: 'reading' })
  },
  {
    id: 'medium',
    name: 'Medium',
    category: 'social',
    hosts: ['medium.com'],
    describe: () => ({ kind: 'reading' })
  },

  // ───────── Media
  {
    id: 'youtube',
    name: 'YouTube',
    category: 'media',
    hosts: ['youtube.com', 'youtu.be'],
    describe: pathKind(
      [
        [/^\/watch|^\/shorts|^\/live/, 'watching'],
        [/^\/results/, 'searching'],
        [/^\/$/, 'browsing']
      ],
      'browsing'
    )
  },
  {
    id: 'netflix',
    name: 'Netflix',
    category: 'media',
    hosts: ['netflix.com'],
    describe: pathKind([[/^\/watch/, 'watching']], 'browsing')
  },
  {
    id: 'prime-video',
    name: 'Prime Video',
    category: 'media',
    hosts: ['primevideo.com'],
    describe: () => ({ kind: 'watching' })
  },
  {
    id: 'disney-plus',
    name: 'Disney+',
    category: 'media',
    hosts: ['disneyplus.com'],
    describe: () => ({ kind: 'watching' })
  },
  {
    id: 'twitch',
    name: 'Twitch',
    category: 'media',
    hosts: ['twitch.tv'],
    describe: () => ({ kind: 'watching' })
  },
  {
    id: 'spotify',
    name: 'Spotify',
    category: 'media',
    bundleIds: ['com.spotify.client'],
    hosts: ['open.spotify.com'],
    describe: () => ({ kind: 'listening' })
  },
  {
    id: 'apple-music',
    name: 'Music',
    category: 'media',
    bundleIds: ['com.apple.Music'],
    describe: () => ({ kind: 'listening' })
  },

  // ───────── Docs / work
  {
    id: 'google-docs',
    name: 'Google Docs',
    category: 'docs',
    hosts: ['docs.google.com'],
    describe: (c) => ({
      kind: /\/spreadsheets\//.test(c.path)
        ? 'in a spreadsheet'
        : /\/presentation\//.test(c.path)
          ? 'in slides'
          : /\/forms\//.test(c.path)
            ? 'in a form'
            : 'writing',
      detail: c.title.replace(/\s*-\s*Google (Docs|Sheets|Slides|Forms)$/i, '')
    })
  },
  { id: 'google-drive', name: 'Google Drive', category: 'docs', hosts: ['drive.google.com'] },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'work',
    hosts: ['calendar.google.com'],
    describe: () => ({ kind: 'scheduling' })
  },
  {
    id: 'apple-calendar',
    name: 'Calendar',
    category: 'work',
    bundleIds: ['com.apple.iCal'],
    describe: () => ({ kind: 'scheduling' })
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'docs',
    bundleIds: ['notion.id'],
    hosts: ['notion.so', 'notion.site'],
    describe: (c) => ({ kind: 'writing', detail: c.title })
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    category: 'docs',
    bundleIds: ['md.obsidian'],
    describe: (c) => ({ kind: 'writing', detail: titleBefore(c.title, / - /) })
  },
  {
    id: 'apple-notes',
    name: 'Notes',
    category: 'docs',
    bundleIds: ['com.apple.Notes'],
    describe: () => ({ kind: 'writing' })
  },
  {
    id: 'word',
    name: 'Word',
    category: 'docs',
    bundleIds: ['com.microsoft.Word'],
    describe: () => ({ kind: 'writing' })
  },
  {
    id: 'excel',
    name: 'Excel',
    category: 'docs',
    bundleIds: ['com.microsoft.Excel'],
    describe: () => ({ kind: 'in a spreadsheet' })
  },
  {
    id: 'powerpoint',
    name: 'PowerPoint',
    category: 'docs',
    bundleIds: ['com.microsoft.Powerpoint'],
    describe: () => ({ kind: 'in slides' })
  },
  {
    id: 'pages',
    name: 'Pages',
    category: 'docs',
    bundleIds: ['com.apple.iWork.Pages'],
    describe: () => ({ kind: 'writing' })
  },
  {
    id: 'numbers',
    name: 'Numbers',
    category: 'docs',
    bundleIds: ['com.apple.iWork.Numbers'],
    describe: () => ({ kind: 'in a spreadsheet' })
  },
  {
    id: 'keynote',
    name: 'Keynote',
    category: 'docs',
    bundleIds: ['com.apple.iWork.Keynote'],
    describe: () => ({ kind: 'in slides' })
  },
  {
    id: 'figma',
    name: 'Figma',
    category: 'work',
    bundleIds: ['com.figma.Desktop'],
    hosts: ['figma.com'],
    describe: () => ({ kind: 'designing' })
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'work',
    bundleIds: ['com.linear'],
    hosts: ['linear.app'],
    describe: () => ({ kind: 'triaging' })
  },
  {
    id: 'jira',
    name: 'Jira',
    category: 'work',
    hosts: ['atlassian.net'],
    describe: () => ({ kind: 'triaging' })
  },
  {
    id: 'asana',
    name: 'Asana',
    category: 'work',
    hosts: ['app.asana.com'],
    describe: () => ({ kind: 'triaging' })
  },
  {
    id: 'trello',
    name: 'Trello',
    category: 'work',
    hosts: ['trello.com'],
    describe: () => ({ kind: 'triaging' })
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    category: 'work',
    hosts: ['app.clickup.com'],
    describe: () => ({ kind: 'triaging' })
  },
  {
    id: 'monday',
    name: 'monday.com',
    category: 'work',
    hosts: ['monday.com'],
    describe: () => ({ kind: 'triaging' })
  },
  { id: 'airtable', name: 'Airtable', category: 'work', hosts: ['airtable.com'] },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'work',
    hosts: ['lightning.force.com', 'salesforce.com']
  },
  { id: 'hubspot', name: 'HubSpot', category: 'work', hosts: ['hubspot.com'] },
  { id: 'stripe', name: 'Stripe', category: 'work', hosts: ['dashboard.stripe.com'] },

  // ───────── Dev
  {
    id: 'github',
    name: 'GitHub',
    category: 'dev',
    hosts: ['github.com'],
    describe: pathKind(
      [
        [/\/pull\/\d+/, 'reviewing a PR'],
        [/\/issues\/\d+/, 'reading an issue'],
        [/\/pulls|\/issues/, 'triaging'],
        [/\/actions/, 'checking CI']
      ],
      'browsing code'
    )
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    category: 'dev',
    hosts: ['gitlab.com'],
    describe: pathKind([[/merge_requests/, 'reviewing a PR']], 'browsing code')
  },
  {
    id: 'stackoverflow',
    name: 'Stack Overflow',
    category: 'dev',
    hosts: ['stackoverflow.com', 'stackexchange.com'],
    describe: () => ({ kind: 'researching' })
  },
  {
    id: 'vscode',
    name: 'VS Code',
    category: 'dev',
    bundleIds: ['com.microsoft.VSCode', 'com.microsoft.VSCodeInsiders', 'com.vscodium'],
    describe: (c) => ({ kind: 'coding', detail: titleBefore(c.title, / [—–-] /) })
  },
  {
    id: 'cursor',
    name: 'Cursor',
    category: 'dev',
    bundleIds: ['com.todesktop.230313mzl4w4u92'],
    describe: () => ({ kind: 'coding' })
  },
  {
    id: 'xcode',
    name: 'Xcode',
    category: 'dev',
    bundleIds: ['com.apple.dt.Xcode'],
    describe: () => ({ kind: 'coding' })
  },
  {
    id: 'jetbrains',
    name: 'JetBrains IDE',
    category: 'dev',
    bundleIds: [
      'com.jetbrains.intellij',
      'com.jetbrains.intellij.ce',
      'com.jetbrains.WebStorm',
      'com.jetbrains.pycharm',
      'com.jetbrains.pycharm.ce',
      'com.jetbrains.goland',
      'com.jetbrains.CLion',
      'com.jetbrains.rider',
      'com.jetbrains.PhpStorm',
      'com.jetbrains.rubymine',
      'com.jetbrains.datagrip',
      'com.google.android.studio'
    ],
    describe: () => ({ kind: 'coding' })
  },
  {
    id: 'terminal',
    name: 'Terminal',
    category: 'dev',
    bundleIds: [
      'com.apple.Terminal',
      'com.googlecode.iterm2',
      'com.mitchellh.ghostty',
      'dev.warp.Warp-Stable',
      'net.kovidgoyal.kitty'
    ],
    describe: () => ({ kind: 'in the shell' })
  },
  {
    id: 'postman',
    name: 'Postman',
    category: 'dev',
    bundleIds: ['com.postmanlabs.mac'],
    describe: () => ({ kind: 'testing APIs' })
  },
  { id: 'docker', name: 'Docker', category: 'dev', bundleIds: ['com.docker.docker'] },

  // ───────── AI
  {
    id: 'claude',
    name: 'Claude',
    category: 'ai',
    bundleIds: ['com.anthropic.claudefordesktop'],
    hosts: ['claude.ai'],
    describe: () => ({ kind: 'chatting with AI' })
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    category: 'ai',
    bundleIds: ['com.openai.chat'],
    hosts: ['chatgpt.com', 'chat.openai.com'],
    describe: () => ({ kind: 'chatting with AI' })
  },
  {
    id: 'gemini',
    name: 'Gemini',
    category: 'ai',
    hosts: ['gemini.google.com'],
    describe: () => ({ kind: 'chatting with AI' })
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    category: 'ai',
    hosts: ['perplexity.ai'],
    describe: () => ({ kind: 'chatting with AI' })
  },

  // ───────── Shopping / finance / misc web
  {
    id: 'amazon',
    name: 'Amazon',
    category: 'other',
    hosts: ['amazon.com', 'amazon.in', 'amazon.co.uk'],
    describe: () => ({ kind: 'shopping' })
  },
  {
    id: 'google-search',
    name: 'Google Search',
    category: 'browsing',
    hosts: ['=google.com', '=www.google.com'],
    describe: pathKind([[/^\/search/, 'searching']], 'browsing')
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    category: 'browsing',
    hosts: ['wikipedia.org'],
    describe: () => ({ kind: 'reading' })
  },
  {
    id: 'todoist',
    name: 'Todoist',
    category: 'work',
    bundleIds: ['com.todoist.mac.Todoist'],
    hosts: ['todoist.com', 'app.todoist.com'],
    describe: () => ({ kind: 'triaging' })
  },
  {
    id: 'things',
    name: 'Things',
    category: 'work',
    bundleIds: ['com.culturedcode.ThingsMac'],
    describe: () => ({ kind: 'triaging' })
  },
  { id: 'loom', name: 'Loom', category: 'meeting', hosts: ['loom.com'] },
  {
    id: 'calendly',
    name: 'Calendly',
    category: 'work',
    hosts: ['calendly.com'],
    describe: () => ({ kind: 'scheduling' })
  },
  {
    id: 'canva',
    name: 'Canva',
    category: 'work',
    hosts: ['canva.com'],
    describe: () => ({ kind: 'designing' })
  },
  { id: 'miro', name: 'Miro', category: 'work', hosts: ['miro.com'] },
  { id: 'dropbox', name: 'Dropbox', category: 'docs', hosts: ['dropbox.com'] },
  {
    id: 'google-keep',
    name: 'Google Keep',
    category: 'docs',
    hosts: ['keep.google.com'],
    describe: () => ({ kind: 'writing' })
  },
  { id: 'skype', name: 'Skype', category: 'messaging', bundleIds: ['com.skype.skype'] },
  { id: 'viber', name: 'Viber', category: 'messaging', bundleIds: ['com.viber.osx'] },
  {
    id: 'zoho-mail',
    name: 'Zoho Mail',
    category: 'email',
    hosts: ['mail.zoho.com'],
    describe: pathKind([[/compose/, 'composing']], 'reading')
  },
  {
    id: 'google-maps',
    name: 'Google Maps',
    category: 'other',
    hosts: ['maps.google.com'],
    describe: () => ({ kind: 'navigating' })
  },
  { id: 'google-photos', name: 'Google Photos', category: 'media', hosts: ['photos.google.com'] },
  {
    id: 'finder',
    name: 'Finder',
    category: 'other',
    bundleIds: ['com.apple.finder'],
    describe: () => ({ kind: 'managing files' })
  }
]
