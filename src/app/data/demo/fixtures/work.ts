/** Alex's work mail at Fernwork, a startup making a shared workspace app. Alex is a product designer. */
import { formatShortDate, formatWeekdayDate } from '../util';
import { appScreen, barChart, lineChart } from './images';
import { L, PRIMARY, type Ctx, type ThreadSpec } from './model';
import { P } from './people';

const { alex, priya, marcus, hannah, tomas, yuki, jonas, dana, sam, leila, ben, rosa } = P;

export function workThreads(c: Ctx): ThreadSpec[] {
  return [
    {
      id: 't-onboarding-v4',
      subject: 'Onboarding v4: final review before handoff',
      labels: [...PRIMARY, 'IMPORTANT', 'STARRED', L.work, L.designReviews],
      unread: 2,
      messages: [
        {
          from: priya,
          to: [alex, marcus, tomas, hannah],
          cc: [yuki],
          at: c.d(2, '09:12'),
          text: `Hi all,

Alex posted the v4 onboarding flow in the Growth file last night (page "v4 / final"). I'd like us to agree on it by Thursday so Tomás can start building on Monday.

Things I'd like eyes on:
1. The workspace naming step. We dropped the template picker from this screen, which I think is right, but let's be sure.
2. The "invite your team" step now has a real skip link instead of the ghost button.
3. Progress indicator: dots vs. the "Step 2 of 4" label.

Please leave comments in the file and reply here with anything bigger.

Thanks,
Priya`,
        },
        {
          from: marcus,
          to: [priya, alex, tomas, hannah],
          cc: [yuki],
          at: c.d(2, '09:40'),
          text: `Looks great. One engineering note on step 1: workspace names have to be unique per region right now, so we need an inline error state for "that name is taken". It happens more than you'd think, there are 400+ workspaces called "Marketing".

Can we suggest an alternative inline (Marketing 2, Marketing Team) instead of just showing red text?`,
        },
        {
          from: alex,
          to: [marcus, priya, tomas, hannah],
          cc: [yuki],
          at: c.d(2, '10:05'),
          text: `Good catch Marcus, I didn't know it was that common. I'll add a taken state with two suggestions as chips under the field. Tapping one fills it in.

On the progress question: I lean towards the "Step 2 of 4" label. Yuki's sessions last month showed people counting the dots out loud, which is a sign the dots weren't doing their job.`,
        },
        {
          from: hannah,
          to: [alex, marcus, priya, tomas],
          cc: [yuki],
          at: c.d(2, '11:30'),
          text: `+1 to the label. From the product side, the thing I care about most is that the invite step doesn't feel mandatory. Our activation number counts a workspace as active even if it's one person, and we lose a lot of solo people at that step today.

Alex, can the skip link say "I'll do this later" instead of "Skip"? Skip sounds like you're missing something.`,
        },
        {
          from: tomas,
          to: [hannah, alex, marcus, priya],
          cc: [yuki],
          at: c.d(2, '14:02'),
          text: `I prototyped the naming step on staging so we can feel the error state for real. Screenshot attached.

Two small things from the build side:
- the chips wrap to two lines on small phones, so maybe cap suggestions at two
- the illustration on the welcome screen is 340 KB as a PNG, could we get an SVG?`,
          attachments: [{ kind: 'png', filename: 'staging-naming-step.png', scene: appScreen('workspace') }],
        },
        {
          from: yuki,
          to: [tomas, hannah, alex, marcus, priya],
          at: c.d(2, '16:45'),
          text: `Adding a bit of research context since I was cc'd.

In the last round, 5 of 8 participants hesitated on the invite step. Three of them said something like "I want to look around first". Nobody complained about the number of steps, they complained about not knowing what came next.

So I'd support the label, and "I'll do this later" tested better in our copy survey too (62% vs 21% preferred it over "Skip").`,
        },
        {
          from: priya,
          to: [yuki, tomas, hannah, alex, marcus],
          at: c.d(1, '08:50'),
          text: `This is a really good thread, thank you. Decisions so far:

- "Step 2 of 4" label, no dots
- Taken name state with max two suggestion chips
- "I'll do this later" on the invite step
- Welcome illustration as SVG

Alex, can you update the file and mark the open comments resolved? Then I think we're there.`,
        },
        {
          from: alex,
          to: [priya, yuki, tomas, hannah, marcus],
          at: c.d(1, '09:30'),
          text: `Done, all four are in the file. I also exported the welcome illustration as SVG (11 KB) and dropped it in the handoff folder.

One thing I changed on my own: the invite step now remembers emails you typed if you go back a step. It was eating them before, which felt bad.`,
        },
        {
          from: marcus,
          to: [alex, priya, yuki, tomas, hannah],
          at: c.d(1, '13:10'),
          text: `Remembering the emails is easy on our side, it's just local state. 👍

I'll write the tickets this afternoon. Tomás, want to pair on the name check endpoint tomorrow?`,
        },
        {
          from: hannah,
          to: [marcus, alex, priya, yuki, tomas],
          at: c.d(1, '17:02'),
          text: `I added the activation events to the tracking plan so we can compare v3 and v4 cleanly. Same event names, new property "flow_version".

Thanks everyone, this went faster than I expected.`,
        },
        {
          from: tomas,
          to: [hannah, marcus, alex, priya, yuki],
          at: c.h(4),
          text: `Yes to pairing. Also, small heads up: I found that the "Step 2 of 4" label needs to announce properly to screen readers when the step changes. I'll use a live region, just flagging it in case Alex wants to tweak how the wording sounds read aloud.`,
        },
        {
          from: priya,
          to: [tomas, hannah, marcus, alex, yuki],
          at: c.m(25),
          text: `Love that. Alex, maybe "Step 2 of 4, invite your team" for the announcement so it has context?

Ship it. Nice work, everyone.`,
        },
      ],
    },
    {
      id: 't-research-readout',
      subject: 'Can we move the pricing page research readout?',
      labels: [...PRIMARY, L.work],
      unread: 0,
      messages: [
        {
          from: hannah,
          to: [alex],
          cc: [yuki],
          at: c.h(5),
          text: `Hey Alex,

Ben just asked to join the pricing research readout, but he's out Thursday. Could we move it to Monday at 11? Yuki is free then.

Also, would it be possible to cut it down to 30 minutes? He'll want the punchline, not the whole deck.

H`,
        },
        {
          from: alex,
          to: [hannah],
          cc: [yuki],
          at: c.m(40),
          draft: true,
          text: `Hi Hannah,

Monday at 11 works for me. I can get it to 30 minutes if we skip the method section and go straight to the three findings. I'll`,
        },
      ],
    },
    {
      id: 't-staging-screens',
      subject: 'Screenshots from today’s staging build',
      labels: [...PRIMARY, L.work],
      unread: 1,
      messages: [
        {
          from: tomas,
          to: [alex],
          at: c.h(2),
          text: `Hey! Quick visual check before I open the PR. This is the welcome screen with your new illustration:

[image:welcome-shot]

And this is the empty workspace state. I wasn't sure if the button should be filled or tonal here, so I went with filled for now:

[image:empty-shot]

Let me know if anything looks off, otherwise I'll ship it to the internal build tonight.

T`,
          attachments: [
            { kind: 'png', filename: 'welcome.png', scene: appScreen('welcome'), contentId: 'welcome-shot' },
            { kind: 'png', filename: 'empty-workspace.png', scene: appScreen('empty'), contentId: 'empty-shot' },
          ],
        },
      ],
    },
    {
      id: 't-design-crit-invite',
      subject: `Invitation: Design crit @ ${formatWeekdayDate(c.ahead(1, '14:00'))}, 2pm to 3pm`,
      labels: [...PRIMARY, L.work],
      unread: 1,
      messages: [
        {
          from: priya,
          to: [alex, P.designTeam],
          at: c.h(7),
          text: `Priya Natarajan has invited you to a meeting.

Design crit
${formatWeekdayDate(c.ahead(1, '14:00'))}, 2:00 pm to 3:00 pm
Room: Lighthouse (3rd floor) and video link in the invite

This week: Alex (onboarding v4), Leila (error messages), Jonas (brand illustrations).
Bring work in progress, not polished stuff. 10 minutes each, then open feedback.

Going? Yes / No / Maybe`,
          attachments: [
            {
              kind: 'ics',
              event: {
                title: 'Design crit',
                start: c.ahead(1, '14:00'),
                end: c.ahead(1, '15:00'),
                location: 'Lighthouse, 3rd floor',
                description: 'This week: Alex (onboarding v4), Leila (error messages), Jonas (brand illustrations).',
                organizer: priya,
                attendees: [alex, leila, jonas, P.designTeam],
              },
            },
          ],
        },
      ],
    },
    {
      id: 't-usability-synthesis',
      subject: 'Usability study synthesis (round 3)',
      labels: [...PRIMARY, L.work, 'STARRED'],
      messages: [
        {
          from: yuki,
          to: [alex, hannah, priya],
          at: c.d(4, '15:20'),
          text: `Hi team,

Attached is the synthesis from round 3 (8 sessions, all new admins of 5 to 20 person teams).

Top three findings:
1. People don't understand that a workspace and a team are different things. We say both.
2. The permissions screen is where trust is won or lost. Three people stopped to read every line.
3. Nobody found the import option. It's in the overflow menu.

Clips are in the research folder, tagged by finding. Happy to walk anyone through it.

Yuki`,
          attachments: [
            {
              kind: 'pdf',
              filename: 'Round 3 synthesis.pdf',
              size: 1_884_160,
              lines: [
                { text: 'Usability study, round 3', size: 20, bold: true },
                { text: 'Fernwork research, onboarding and admin setup', size: 12 },
                { text: 'Participants', bold: true, gap: 16 },
                { text: '8 new admins of teams with 5 to 20 people. Remote sessions, 45 minutes each.' },
                { text: 'Finding 1: workspace vs team', bold: true, gap: 12 },
                { text: 'We use both words for the same thing in 11 places. Participants assumed two products.' },
                { text: 'Finding 2: permissions build trust', bold: true, gap: 12 },
                { text: 'Three participants read every line of the permissions screen before continuing.' },
                { text: 'Finding 3: import is invisible', bold: true, gap: 12 },
                { text: 'No participant found import. It lives in the overflow menu on the empty state.' },
              ],
            },
          ],
        },
        {
          from: alex,
          to: [yuki],
          cc: [hannah, priya],
          at: c.d(4, '16:02'),
          text: `This is so useful, thank you Yuki. Finding 1 explains a bunch of support tickets I've been confused about.

I'll pull the import option out of the overflow menu in v4. Would you be up for a quick test of that change next sprint?`,
        },
        {
          from: yuki,
          to: [alex],
          cc: [hannah, priya],
          at: c.d(3, '09:15'),
          text: `Yes, happy to. Let's do 5 unmoderated sessions, should take a week.`,
        },
      ],
    },
    {
      id: 't-brand-voice',
      subject: 'Brand voice guidelines v2 (Feedback bis Freitag?)',
      labels: [...PRIMARY, L.work],
      unread: 0,
      messages: [
        {
          from: jonas,
          to: [alex, leila],
          at: c.d(3, '11:47'),
          text: `Hallo ihr beiden,

here is v2 of the brand voice doc. Biggest change: we now have three "dials" (warmth, confidence, playfulness) instead of the long list of adjectives. It should be much easier to use when you're writing UI copy.

Could you leave feedback by Friday? Ich weiß, it's a busy week.

Viele Grüße aus Berlin,
Jonas

P.S. Leila, the section on error messages borrows heavily from your work. Please check I didn't butcher it.`,
          attachments: [
            {
              kind: 'docx',
              filename: 'Brand voice guidelines v2.docx',
              size: 248_320,
              paragraphs: [
                'Fernwork brand voice, v2',
                'We sound like a helpful colleague: warm, clear, and never in a hurry to sell.',
                'Dial 1: warmth. Turn it up in onboarding and empty states, down in billing and security.',
                'Dial 2: confidence. Say what will happen. Avoid "might" and "should" when we know.',
                'Dial 3: playfulness. Rarely. Never in errors, never when someone could lose work.',
                'Error messages: say what happened, why, and what to do next. In that order.',
              ],
            },
          ],
        },
        {
          from: leila,
          to: [jonas],
          cc: [alex],
          at: c.d(3, '14:30'),
          text: `Jonas, this is lovely and you did not butcher anything. The dials are a great idea.

One suggestion: add two or three real before/after examples to each dial. People learn from examples way faster than from rules.`,
        },
        {
          from: alex,
          to: [jonas, leila],
          at: c.d(2, '18:20'),
          text: `Agree with Leila on examples. I'd also love a short section on button labels, since that's where most of our inconsistency lives ("Create", "Add", "New", "Make" all mean the same thing right now).

Danke Jonas, this is a huge improvement.`,
        },
      ],
    },
    {
      id: 't-empty-states',
      subject: 'Quick q about the empty states',
      labels: [...PRIMARY, L.work],
      messages: [
        {
          from: marcus,
          to: [alex],
          at: c.d(1, '11:05'),
          text: `Hey, for the new empty states, do the illustrations need to support dark mode? If so I'll ask Jonas for dark variants before we build. If not I'll just put them on a light card.`,
        },
        {
          from: alex,
          to: [marcus],
          at: c.d(1, '11:20'),
          text: `They do, sorry, should have said. Jonas already has dark versions in the brand file under "Illustrations / dark". Same names with a -dark suffix.`,
        },
        {
          from: marcus,
          to: [alex],
          at: c.d(1, '11:22'),
          text: `Perfect.`,
        },
      ],
    },
    {
      id: 't-10k-teams',
      subject: '🎉 We just passed 10,000 weekly active teams',
      labels: [...PRIMARY, L.work],
      unread: 1,
      messages: [
        {
          from: ben,
          to: [P.fernworkAll],
          at: c.h(6),
          text: `Hi everyone,

This morning we crossed 10,000 weekly active teams. A year ago it was 3,400.

I want to call out a few things that moved this number more than anything else: the new onboarding (Alex, Tomás, Marcus, Hannah), the import tool (Sam and the platform crew), and support answering in under an hour on average all quarter (Rosa's team).

Cake on the 4th floor at 3. There is a gluten free one, Dana made sure.

Ben`,
          attachments: [{ kind: 'png', filename: 'weekly-active-teams.png', scene: lineChart([3.4, 3.9, 4.6, 5.1, 5.8, 6.4, 7.3, 8.1, 8.9, 9.6, 10.1]) }],
        },
      ],
    },
    {
      id: 't-settings-ia',
      subject:
        'Re: Follow-up on the follow-up about whether the settings page should use tabs or a sidebar now that we have more than twelve sections and the mobile layout is also in question',
      labels: [...PRIMARY, L.work, L.designReviews],
      messages: [
        {
          from: sam,
          to: [alex, rosa],
          at: c.d(5, '10:12'),
          text: `Okay I know this subject line is getting ridiculous, but I think we're close.

Proposal: sidebar on desktop, a single list that pushes into each section on mobile. Tabs just don't work past six or seven items, and we have fourteen.`,
        },
        {
          from: rosa,
          to: [sam, alex],
          at: c.d(5, '13:40'),
          text: `I'm fine with the sidebar. My only ask is search at the top of it. Support gets asked "where is the setting for X" every single day.`,
        },
        {
          from: alex,
          to: [rosa, sam],
          at: c.d(4, '09:05'),
          text: `Sidebar plus search it is. I'll group the fourteen sections into four headings (Account, Workspace, Billing, Advanced) so the list isn't a wall. Mocks by Friday.

And I promise to start a new thread next time.`,
        },
      ],
    },
    {
      id: 't-error-copy',
      subject: 'Error message copy pass, 46 strings',
      labels: [...PRIMARY, L.work],
      messages: [
        {
          from: leila,
          to: [alex],
          at: c.d(6, '14:15'),
          text: `Hi Alex,

Here's the full list of error strings from the app with my proposed rewrites. The CSV has the string key, where it shows up, the current copy, and my version.

I flagged 9 where I'm not sure what actually happened technically, so I couldn't say what the person should do next. Could you look at those with me? 20 minutes is plenty.

Leila`,
          attachments: [
            {
              kind: 'csv',
              filename: 'error-strings-rewrite.csv',
              rows: [
                ['key', 'surface', 'current', 'proposed', 'needs_eng'],
                ['err.upload.size', 'File upload', 'Upload failed.', 'This file is over 100 MB. Try compressing it or sharing a link instead.', 'no'],
                ['err.invite.domain', 'Invite dialog', 'Invalid domain.', 'Only people with an @yourcompany address can join this workspace.', 'no'],
                ['err.sync.conflict', 'Editor', 'Conflict detected.', 'Someone else edited this at the same time. We kept both versions.', 'yes'],
                ['err.billing.card', 'Billing', 'Payment error.', 'Your card was declined. Check the details or try another card.', 'no'],
                ['err.export.timeout', 'Export', 'Request timed out.', 'This export is taking longer than usual. We’ll email you when it’s ready.', 'yes'],
                ['err.auth.expired', 'Sign in', 'Session expired.', 'You were signed out after 30 days. Sign in again to pick up where you left off.', 'no'],
              ],
            },
          ],
        },
        {
          from: alex,
          to: [leila],
          at: c.d(6, '15:01'),
          text: `These are so much better. Grabbed 20 minutes tomorrow at 10, and I'll bring Marcus for the technical ones.`,
        },
      ],
    },
    {
      id: 't-one-on-one',
      subject: '1:1 notes and growth plan',
      labels: [...PRIMARY, L.work, 'STARRED', 'IMPORTANT'],
      messages: [
        {
          from: priya,
          to: [alex],
          at: c.d(8, '17:30'),
          text: `Hi Alex,

Thanks for a great 1:1 today. Notes below so we both remember.

What's going well
- You've become the person people go to for flows that touch more than one team. That's a senior skill.
- Onboarding v4 is the cleanest handoff we've had this year.

What to work on
- Speak up earlier in planning. Your best ideas show up in crit, after the scope is already set.
- Write more. A one-page "why" doc for v4 would have saved us two meetings.

Next steps
- You'll lead the settings IA work end to end, including the planning doc.
- Let's revisit the senior designer expectations doc together in November.

Proud of you. Truly.
Priya`,
          attachments: [
            {
              kind: 'docx',
              filename: 'Growth plan, Alex Rivera.docx',
              size: 61_440,
              paragraphs: [
                'Growth plan: Alex Rivera',
                'Goal: Senior Product Designer by Q2.',
                'Lead the settings IA project, including the planning doc and stakeholder reviews.',
                'Write one short decision doc per project.',
                'Mentor the new design intern starting in January.',
              ],
            },
          ],
        },
      ],
    },
    {
      id: 't-billing-review',
      subject: 'Design review notes: Billing settings',
      labels: [...PRIMARY, L.work, L.designReviews],
      messages: [
        {
          from: rosa,
          to: [alex, sam],
          cc: [priya],
          at: c.d(9, '16:10'),
          text: `Notes from today's billing review:

1. Show the next invoice date and amount at the top. That's the number people come here for.
2. "Downgrade" should not be a red button. It isn't destructive, nothing gets deleted.
3. Seat count changes need a preview of the new price before confirming.
4. Tax IDs: the field needs a country picker first, or the validation is meaningless.

Alex owns 1 to 3, Sam owns 4. Let's look again next Wednesday.`,
          attachments: [{ kind: 'png', filename: 'billing-v2-annotated.png', scene: appScreen('invite') }],
        },
      ],
    },
    {
      id: 't-laptop',
      subject: 'Your laptop refresh is ready for pickup',
      labels: [...PRIMARY, L.work],
      messages: [
        {
          from: P.fernworkIt,
          to: [alex],
          at: c.d(7, '10:00'),
          text: `Hi Alex,

Your new laptop is ready. Pick it up at the IT desk (2nd floor, next to the kitchen) any weekday between 10 and 4.

Please bring your old machine and charger. We'll move your files over while you wait, it takes about 40 minutes.

Ticket: IT-20931

Fernwork IT`,
        },
      ],
    },
    {
      id: 't-offsite',
      subject: 'Lisbon offsite: flights and rooms',
      labels: [...PRIMARY, L.work, L.travel],
      messages: [
        {
          from: dana,
          to: [alex, P.designTeam],
          at: c.d(11, '12:30'),
          text: `Hi design team!

The offsite is confirmed for ${formatShortDate(c.ahead(40, '09:00'))} to ${formatShortDate(c.ahead(43, '09:00'))} in Lisbon. 🎉

Flights: please book through the travel tool by ${formatShortDate(c.ahead(12, '09:00'))} so we get the group rate. Economy, and pick something that lands before 6pm on ${formatShortDate(c.ahead(40, '09:00'))}.
Rooms: we have the whole top floor at Casa Lumiar in Príncipe Real. Rooms are single, no sharing.
Dietary needs and accessibility requests: reply to me directly.

Agenda coming soon. There will be at least one afternoon with nothing scheduled, I promise.

Dana`,
        },
        {
          from: alex,
          to: [dana],
          at: c.d(11, '13:02'),
          text: `Amazing, thank you Dana. I'm vegetarian, and I'd love a room away from the elevator if that's possible. Booking flights tonight.`,
        },
        {
          from: dana,
          to: [alex],
          at: c.d(10, '09:40'),
          text: `Noted on both! You're in room 41, at the quiet end of the hall.`,
        },
      ],
    },
    {
      id: 't-retention-dashboard',
      subject: 'Retention numbers for the v3 onboarding',
      labels: [...PRIMARY, L.work],
      messages: [
        {
          from: hannah,
          to: [alex, priya],
          at: c.d(13, '11:15'),
          text: `Hi both,

Week 4 retention by onboarding cohort, so we have a baseline before v4 ships. v3 is the last bar.

Short version: v3 is up 6 points over v2, and almost all of the gain is from teams that invited someone in the first session. Which is why I keep going on about the invite step. 🙂

H`,
          attachments: [{ kind: 'png', filename: 'w4-retention-by-cohort.png', scene: barChart([31, 33, 32, 36, 38, 44]) }],
        },
      ],
    },
    {
      id: 't-intern-mentor',
      subject: 'Mentoring the design intern in January?',
      labels: [...PRIMARY, L.work],
      unread: 1,
      messages: [
        {
          from: priya,
          to: [alex],
          at: c.h(9),
          text: `Hey Alex,

We're hiring a design intern for January to April. Would you want to be their mentor? It's about two hours a week, plus a weekly 1:1.

No pressure at all, and it's fine to say the timing is bad. I just think you'd be great at it, and it lines up with your growth plan.`,
        },
      ],
    },
  ];
}
