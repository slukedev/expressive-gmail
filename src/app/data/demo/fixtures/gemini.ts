/** Hand-written Gemini answers for a few demo conversations, so the preview shows what a good summary reads like. */
export interface GeminiFixture {
  summary?: string;
  actions?: string;
  replies?: { label: string; text: string }[];
  /** Help me write's answer when the prompt agrees to what was asked. */
  write?: string;
  /** AI Inbox's to-do for this conversation. */
  todo?: { text: string; dueInDays?: number };
}

export const GEMINI_FIXTURES: Record<string, GeminiFixture> = {
  't-onboarding-v4': {
    summary: [
      '- The team agreed on onboarding v4: a **“Step 2 of 4” label** instead of dots, a **taken-name state** with at most two suggestion chips, **“I’ll do this later”** on the invite step, and the welcome illustration as an **SVG**.',
      '- You updated the file, and the invite step now keeps typed emails when someone goes back.',
      '- Marcus is writing the tickets; Tomás and Marcus will pair on the name check. Hannah added a `flow_version` property to the tracking plan.',
      '- **Open for you:** Tomás will announce step changes to screen readers, and Priya suggests the wording “Step 2 of 4, invite your team”.',
    ].join('\n'),
    actions: [
      'Action items in this conversation:',
      '',
      '- **You**: decide how the step label reads aloud. Priya suggests “Step 2 of 4, invite your team”.',
      '- **Marcus**: write the tickets.',
      '- **Tomás and Marcus**: pair on the name check endpoint tomorrow.',
      '- **Tomás**: announce step changes with a live region.',
    ].join('\n'),
    replies: [
      {
        label: 'Use Priya’s wording',
        text: 'Hi all,\n\n“Step 2 of 4, invite your team” works for me. Tomás, go ahead with that for the live region and I’ll match it in the file.\n\nThanks for a quick review, everyone.\n\nAlex',
      },
      {
        label: 'I’ll check it with VoiceOver',
        text: 'Hi Tomás,\n\nThanks for catching that. Once it’s on staging I’ll listen to it with VoiceOver and send you any wording tweaks.\n\nAlex',
      },
      {
        label: 'Thanks, everyone',
        text: 'Thanks, everyone. This was a great review. I’ll keep an eye on the tickets as they come in.\n\nAlex',
      },
    ],
    todo: { text: 'Settle how “Step 2 of 4” reads aloud for Tomás’s live region' },
    write: 'Hi Priya,\n\n“Step 2 of 4, invite your team” is a good call. I’ll update the file today, and Tomás can use the same wording for the live region.\n\nThanks for pulling the decisions together.\n\nAlex',
  },
  't-research-readout': {
    summary: [
      '- Hannah asks to move the **pricing research readout to Monday at 11**, since Ben wants to join and is out Thursday. Yuki is free then.',
      '- She’d also like it **cut to 30 minutes**, with the findings up front.',
      '- You have a reply drafted that agrees and suggests skipping the method section.',
    ].join('\n'),
    replies: [
      {
        label: 'Monday at 11 works',
        text: 'Hi Hannah,\n\nMonday at 11 works for me. I’ll cut it to 30 minutes by skipping the method section and going straight to the three findings.\n\nAlex',
      },
      {
        label: 'Can we do Tuesday?',
        text: 'Hi Hannah,\n\nMonday is packed for me. Could we do Tuesday morning instead? Happy to keep it to 30 minutes either way.\n\nAlex',
      },
    ],
    todo: { text: 'Confirm Monday at 11 for the pricing readout and trim it to 30 minutes' },
    write: 'Hi Hannah,\n\nMonday at 11 works for me. I’ll get it down to 30 minutes by skipping the method section and opening with the three findings, so Ben gets the punchline first.\n\nAlex',
  },
  't-lease-renewal': {
    summary: [
      '- Gerald from Pike Property Management offers a **12-month renewal** of 418 Linden St, Unit 3B at **$2,415 a month** (up 3%). The agreement is attached.',
      '- **Sign and return by November 15.**',
      '- You asked about the loud bathroom fan; Gerald is sending Ray from Delgado Plumbing to fix it.',
    ].join('\n'),
    todo: { text: 'Sign and return the lease renewal by November 15' },
  },
  't-sofia-portfolio': {
    summary: [
      '- Sofia asked for honest notes on her architecture internship portfolio before Friday’s deadline.',
      '- You suggested leading with the **timber pavilion**, **bigger captions**, and cutting the sketchbook to **six pages**.',
      '- She’s moving the pavilion first.',
    ].join('\n'),
    replies: [
      { label: 'Send me the new version', text: 'Send me the new version when it’s ready and I’ll take one more look before Friday. So proud of you.\n\nAlex' },
      { label: 'Good luck!', text: 'Good luck, Sof! You’ve got this.\n\nAlex' },
    ],
  },
};
