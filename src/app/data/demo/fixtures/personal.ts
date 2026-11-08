/** Friends, family and life admin. */
import { formatWeekdayDate } from '../util';
import { balconyPlants, barChart, cakePhoto, ceilingStain, landscape } from './images';
import { L, PRIMARY, type Ctx, type ThreadSpec } from './model';
import { P } from './people';

const { alex, jordan, mira, theo, nadia, kenji, omar, greta, chris, mom, dad, sofia } = P;

export function personalThreads(c: Ctx): ThreadSpec[] {
  const appt = c.ahead(6, '08:40');
  const year = new Date(c.now).getFullYear();
  const next = year + 1;
  return [
    {
      id: 't-climbing',
      subject: 'climbing saturday?',
      labels: [...PRIMARY],
      unread: 1,
      messages: [
        {
          from: jordan,
          to: [alex, theo],
          at: c.h(30),
          text: `the new gym on 40th has a free first visit if you bring a friend. saturday morning? I can drive`,
        },
        {
          from: theo,
          to: [jordan, alex],
          at: c.h(29),
          text: `I'm in but not before 10. my body does not do 8am bouldering`,
        },
        {
          from: alex,
          to: [jordan, theo],
          at: c.h(27),
          text: `10:30 works! I still have the shoes from the last time I swore I'd get into this. let's go`,
        },
        {
          from: jordan,
          to: [alex, theo],
          at: c.m(55),
          text: `perfect. picking up alex first then theo. bring snacks, the vending machine there is all protein bars that taste like drywall`,
        },
      ],
    },
    {
      id: 't-mira-letter',
      subject: 'A long overdue letter from Copenhagen',
      labels: [...PRIMARY, 'STARRED', 'IMPORTANT'],
      unread: 0,
      messages: [
        {
          from: mira,
          to: [alex],
          at: c.d(3, '21:48'),
          text: `Dear Alex,

I've started this email four times. Every time I think of something else I want to tell you and it turns into a list, so tonight I'm just going to write and see where it goes.

We've been here seven months now. The light is the thing nobody warns you about properly. In June it never really got dark, and now in October it's dark by six and everyone has candles on every surface. There's a word for it that I refuse to say out loud because it's on every tote bag in the airport, but I get it now. It's less about cozy and more about deciding, together, that winter is going to be fine.

Work is good. Different. The studio is small, eleven of us, and nobody works past five. The first month I kept staying late out of habit and Freja, who sits next to me, finally asked if I was okay. Like, genuinely concerned. I've been leaving at five ever since and I don't think my work is worse. I think it might be better? I have time to think on the bike home.

I bike everywhere. I fell off twice in the first week, once in front of a whole class of seven year olds on a field trip. They clapped.

The hard part has been friends. It's easy to meet people and hard to get past the first coffee. I miss having people I don't have to explain myself to. I miss you showing up with too many groceries and cooking something ambitious on a Tuesday. I miss our walks around the lake where we'd solve everybody's problems except our own.

How are you, really? Last time we talked you were thinking about the senior role and whether you even wanted it. I hope you're letting yourself want things. You were always better at that for other people than for yourself.

Also: please come visit. The spare room has a window that looks onto a courtyard with a very old chestnut tree, and I've already decided it's your room. Spring is the best time, apparently. I'll believe it when I see it.

Write back when you can, even if it's short. Especially if it's short, actually. I'd rather have three lines from you than wait for the perfect long one.

All my love,
Mira

P.S. I found a bakery that makes cardamom buns almost as good as the ones from that place on Grand that closed. Almost.`,
        },
        {
          from: alex,
          to: [mira],
          at: c.d(2, '22:15'),
          text: `Mira, I read this twice on the bus and nearly missed my stop.

Short version, as requested: I miss you too. I said yes to wanting the senior role. I'm coming in April, so tell the chestnut tree.

Long version this weekend. With a photo of the ambitious Tuesday dinner I'm making tonight, which is a lasagna with too many layers.

Love,
Alex`,
        },
      ],
    },
    {
      id: 't-plantwise-beta',
      subject: 'Plantwise beta: the numbers so far',
      labels: [...PRIMARY, L.sideProject, 'STARRED'],
      unread: 1,
      messages: [
        {
          from: theo,
          to: [alex],
          at: c.d(5, '20:30'),
          text: `ok so the beta has been live for two weeks and I have NUMBERS

- 212 people signed up from the waitlist
- 140 added at least one plant
- 61 got a watering reminder and actually tapped "done"
- the average person has 6.3 plants, which is way more than I expected

the drop between "signed up" and "added a plant" is the big one. I think the plant search is too strict, people type "snake plant" and we only know "Sansevieria". chart attached because I'm a nerd`,
          attachments: [{ kind: 'png', filename: 'plantwise-signups.png', scene: barChart([18, 26, 31, 29, 40, 68], '#146c2e', '#a8dab5') }],
        },
        {
          from: alex,
          to: [theo],
          at: c.d(5, '21:12'),
          text: `THEO these are great numbers for a side project with zero marketing.

Agree the search is the problem. What if we add common names as aliases and show a photo grid when there's no exact match? People recognize their plant way faster than they can name it. I can mock it up this weekend.`,
        },
        {
          from: theo,
          to: [alex],
          at: c.d(4, '08:02'),
          text: `photo grid is a great idea. I found an open plant dataset with common names in 14 languages, I'll wire it up.

also, my sister wants to know if we can add a "my cat chews this, is it toxic" warning. honestly might be our killer feature`,
        },
        {
          from: alex,
          to: [theo],
          at: c.d(3, '19:40'),
          text: `Toxic-to-pets badge is a must. Mocks are in our shared folder: search with aliases, the photo grid, and a pet-safe filter on the plant list.`,
          attachments: [
            {
              kind: 'pdf',
              filename: 'Plantwise search mocks.pdf',
              size: 3_407_872,
              lines: [
                { text: 'Plantwise: plant search v2', size: 18, bold: true },
                { text: 'Mocks for the beta, by Alex', size: 11 },
                { text: '1. Search matches common names, scientific names and nicknames.', gap: 14 },
                { text: '2. No exact match? Show a photo grid of the 12 closest plants.' },
                { text: '3. Pet-safe badge and filter on the plant list.' },
              ],
            },
          ],
        },
        {
          from: theo,
          to: [alex],
          at: c.h(20),
          text: `these are beautiful. shipping the search part this week. drinks on me when we hit 1000 users (or 500, I'm not proud)`,
        },
      ],
    },
    {
      id: 't-book-club',
      subject: 'Book club: November pick',
      labels: [...PRIMARY],
      messages: [
        {
          from: nadia,
          to: [alex, jordan, mira],
          cc: [chris],
          at: c.d(6, '18:05'),
          text: `Hi lovely readers,

Votes are in and we're reading the lighthouse keeper one for November. It's short, so no excuses this time Chris.

My place on the 21st, 7pm. I'm making soup. Bring bread or wine or opinions.

Nadia`,
        },
        {
          from: chris,
          to: [nadia, alex, jordan, mira],
          at: c.d(6, '19:30'),
          text: `I resent this. I'll be there. I'll bring bread AND opinions.`,
        },
        {
          from: alex,
          to: [nadia, chris, jordan, mira],
          at: c.d(5, '08:15'),
          text: `Count me in! Mira, you can join on video if the time zones work, it would be 4am for you so maybe not.`,
        },
      ],
    },
    {
      id: 't-kenji-tokyo',
      subject: '来月の東京旅行について',
      labels: [...PRIMARY, L.travel],
      unread: 1,
      messages: [
        {
          from: kenji,
          to: [alex],
          at: c.h(16),
          text: `アレックスさん

お久しぶりです！来月の東京旅行、楽しみにしています。

泊まる場所はもう決まりましたか？もしまだなら、谷中のあたりが静かでおすすめです。古いお寺やカフェが多くて、散歩するのにちょうどいいですよ。

土曜日の夜は空いているので、一緒にご飯に行きましょう。焼き鳥とお好み焼き、どちらがいいですか？

(English version because my keyboard is faster in Japanese: Looking forward to your trip! Stay in Yanaka if you can, it's quiet and great for walks. Saturday dinner? Yakitori or okonomiyaki?)

健二`,
        },
      ],
    },
    {
      id: 't-omar',
      subject: 'تهنئة بالمنزل الجديد',
      labels: [...PRIMARY],
      messages: [
        {
          from: omar,
          to: [alex],
          at: c.d(9, '20:10'),
          dir: 'rtl',
          text: `مرحبا أليكس،

ألف مبروك على الشقة الجديدة! سمعت من جوردن أن فيها شرفة كبيرة ونور جميل في الصباح.

أرسلت لك هدية صغيرة بالبريد، أتمنى أن تعجبك. إنها نبتة زيتون صغيرة، تحتاج إلى الكثير من الشمس وقليل من الماء.

مع أطيب التحيات،
عمر`,
        },
        {
          from: alex,
          to: [omar],
          at: c.d(8, '09:30'),
          text: `Omar, thank you! The olive tree arrived this morning and it's already on the balcony in the sunniest spot. شكرا جزيلا 🌿

Come see it when you're back in town.`,
        },
      ],
    },
    {
      id: 't-greta',
      subject: 'Grüße aus München und eine Frage',
      labels: [...PRIMARY],
      messages: [
        {
          from: greta,
          to: [alex],
          at: c.d(12, '07:55'),
          text: `Hallo Alex,

ich hoffe, dir geht's gut! Hier in München ist schon richtig Herbst, die Blätter im Englischen Garten sind wunderschön.

Kurze Frage: Kennst du jemanden, der gerade nach einer UX-Researcherin sucht? Meine Kollegin Jülide zieht im Frühjahr nach Kalifornien und würde gern bei einem kleineren Startup arbeiten. Sie ist großartig.

Liebe Grüße und bis bald,
Greta

(Sorry for the German, I forgot again! Short version: do you know anyone hiring a UX researcher in California? My colleague Jülide is moving there in spring.)`,
        },
        {
          from: alex,
          to: [greta],
          at: c.d(11, '12:40'),
          text: `Hallo Greta! My German is still terrible but I understood "Englischer Garten" and got jealous.

Yes! We might be hiring a second researcher next year. Send me Jülide's portfolio and I'll pass it to Yuki, who runs research here.`,
        },
      ],
    },
    {
      id: 't-no-subject',
      subject: '',
      labels: [...PRIMARY],
      unread: 1,
      messages: [
        {
          from: chris,
          to: [alex],
          at: c.h(3),
          text: `you around saturday afternoon? need help getting a couch up three flights of stairs. will pay in pizza and eternal gratitude`,
        },
      ],
    },
    {
      id: 't-abuela-90',
      subject: 'Abuela’s 90th 🎂 planning',
      labels: [...PRIMARY, L.family, 'IMPORTANT'],
      unread: 2,
      messages: [
        {
          from: mom,
          to: [alex, sofia],
          cc: [dad],
          at: c.d(4, '19:02'),
          text: `Hola mis amores,

Abuela turns 90 on the 14th of next month and I want to do something special. She says she doesn't want a party, which means she wants a party.

Ideas so far:
- Lunch at the house on Sunday the 15th
- Tía Carmen is flying in from Guadalajara
- A photo book with pictures from every decade (Alex, can you design it? You're the artist)

Sofia, can you call the bakery? The one with the tres leches she likes.

Besos,
Mamá`,
        },
        {
          from: sofia,
          to: [mom, alex],
          cc: [dad],
          at: c.d(4, '20:45'),
          text: `YES to the photo book. I'll call the bakery tomorrow. Do we want 90 candles or is that a fire hazard`,
        },
        {
          from: alex,
          to: [mom, sofia],
          cc: [dad],
          at: c.d(3, '08:30'),
          text: `I'd love to make the photo book! Mom, can you scan whatever's in the blue albums in the hall closet? Even phone photos of the photos are fine, I can clean them up.

And Sofia, two candles, a 9 and a 0. Let's not burn down the house.`,
        },
        {
          from: dad,
          to: [alex, mom, sofia],
          at: c.d(2, '07:15'),
          text: `I found the albums. There are eleven of them. Your mother says I can't just send all of them. I'm sending all of them.

Love, Dad`,
        },
        {
          from: sofia,
          to: [mom, alex],
          cc: [dad],
          at: c.h(8),
          text: `Bakery said yes! They're even doing a little sugar hibiscus on top since that's her favorite flower. Here's the sketch they sent:

[image:cake-sketch]

Dad, I'm so sorry about your inbox Alex`,
          attachments: [{ kind: 'png', filename: 'cake-sketch.png', scene: cakePhoto(), contentId: 'cake-sketch' }],
        },
        {
          from: mom,
          to: [sofia, alex],
          cc: [dad],
          at: c.h(1),
          text: `Que bonito!! She is going to cry. I'm going to cry.`,
        },
      ],
    },
    {
      id: 't-mom-balcony',
      subject: 'The balcony garden update you asked for',
      labels: [...PRIMARY, L.family],
      messages: [
        {
          from: mom,
          to: [alex],
          at: c.d(7, '16:20'),
          text: `Mijo, here is the balcony! The tomatoes are done for the year but the basil won't stop. I put the new marigolds in your old blue pot.

Your dad built a little shelf for the herbs. He wants you to know he did it without instructions.`,
          attachments: [{ kind: 'png', filename: 'balcony.png', scene: balconyPlants(), size: 2_310_144 }],
        },
        {
          from: alex,
          to: [mom],
          at: c.d(7, '18:05'),
          text: `It looks so good! Tell Dad the shelf is very level, I can tell from here. Save me some basil.`,
        },
      ],
    },
    {
      id: 't-sofia-portfolio',
      subject: 'can you look at my portfolio before friday 🙏',
      labels: [...PRIMARY, L.family],
      messages: [
        {
          from: sofia,
          to: [alex],
          at: c.d(5, '23:10'),
          text: `hiii

I'm applying to the architecture internship and the deadline is friday. can you look at my portfolio and tell me if the layout is a mess? be honest but also be nice

love you`,
          attachments: [
            {
              kind: 'pdf',
              filename: `Sofia Rivera Portfolio ${year}.pdf`,
              size: 7_864_320,
              lines: [
                { text: 'Sofia Rivera', size: 26, bold: true },
                { text: `Architecture portfolio, ${year}`, size: 13 },
                { text: '01  Community library, studio project', gap: 24 },
                { text: '02  Courtyard housing study' },
                { text: '03  Timber pavilion, built with classmates' },
                { text: '04  Sketchbook' },
              ],
            },
          ],
        },
        {
          from: alex,
          to: [sofia],
          at: c.d(4, '07:45'),
          text: `Sof, this is really good. Honest notes:

1. Lead with the pavilion, not the library. It's built, it's real, and the photos are great.
2. Your captions are tiny. Bump them up two sizes.
3. Cut the sketchbook to your best 6 pages. Less is more confident.

You're going to get this. Call me tonight if you want to go through it.`,
        },
        {
          from: sofia,
          to: [alex],
          at: c.d(4, '08:01'),
          text: `ok moving the pavilion first. you're the best`,
        },
      ],
    },
    {
      // Archived and big: the one conversation Storage finds over 10 MB.
      id: 'x-dad-slides',
      subject: 'Scanned the slides from the garage',
      labels: ['CATEGORY_PERSONAL'],
      messages: [
        {
          from: dad,
          at: c.d(160, '19:20'),
          text: `Finally went through the box of slides in the garage. Scanned the two your mother keeps asking about. Big files, sorry, the scanner only has one setting.`,
          attachments: [
            { kind: 'png', filename: 'slides-lake-1998.png', scene: landscape('lake'), size: 6_291_456 },
            { kind: 'png', filename: 'slides-dusk-1999.png', scene: landscape('dusk'), size: 5_767_168 },
          ],
        },
      ],
    },
    {
      id: 't-dad-insurance',
      subject: 'Fwd: Your car insurance renewal',
      labels: [...PRIMARY, L.family],
      messages: [
        {
          from: dad,
          to: [alex],
          at: c.d(15, '09:20'),
          text: `Is this a good price? It went up a lot. Can you look when you have a minute.

---------- Forwarded message ---------
From: Harborline Insurance <renewals@harborline.example>
Subject: Your car insurance renewal

Your policy renews on the 1st of next month. Your new premium is $1,284 for 12 months (previously $1,036). No action is needed to renew.`,
        },
        {
          from: alex,
          to: [dad],
          at: c.d(15, '12:10'),
          text: `It did go up a lot, Dad. Everyone's premiums went up this year, but I'd still call and ask about the safe driver discount. You haven't had a claim in ten years. Want me to get a couple of quotes to compare?`,
        },
        {
          from: dad,
          to: [alex],
          at: c.d(14, '08:00'),
          text: `Yes please. Thank you mijo.`,
        },
      ],
    },
    {
      id: 't-lease-renewal',
      subject: `Lease renewal for ${next}, unit 3B`,
      labels: [...PRIMARY, 'IMPORTANT', 'STARRED'],
      unread: 0,
      messages: [
        {
          from: P.landlord,
          to: [alex],
          at: c.d(6, '10:30'),
          text: `Dear Alex,

Your current lease for 418 Linden St, Unit 3B ends on December 31. We'd be happy to renew for another 12 months.

The new monthly rent would be $2,415 (a 3% increase, in line with the local cap). All other terms stay the same. The renewal agreement is attached.

Please sign and return by November 15. Let me know if you have any questions.

Best regards,
Gerald Pike
Pike Property Management`,
          attachments: [
            {
              kind: 'pdf',
              filename: `Lease renewal ${next}, 418 Linden St 3B.pdf`,
              size: 412_672,
              lines: [
                { text: 'Residential Lease Renewal Agreement', size: 18, bold: true },
                { text: 'Property: 418 Linden St, Unit 3B', gap: 12 },
                { text: 'Tenant: Alex Rivera' },
                { text: 'Landlord: Pike Property Management' },
                { text: `Term: January 1, ${next} to December 31, ${next}`, gap: 12 },
                { text: 'Monthly rent: $2,415.00, due on the 1st of each month' },
                { text: 'Security deposit: unchanged' },
                { text: 'All other terms of the original lease remain in effect.', gap: 12 },
                { text: 'Tenant signature: ______________________   Date: __________', gap: 40 },
                { text: 'Landlord signature: ____________________   Date: __________', gap: 20 },
              ],
            },
          ],
        },
        {
          from: alex,
          to: [P.landlord],
          at: c.d(5, '18:40'),
          text: `Hi Gerald,

Thanks for sending this. I'd like to renew. Before I sign, could the bathroom fan be looked at? It's been very loud since August.

Thanks,
Alex`,
        },
        {
          from: P.landlord,
          to: [alex],
          at: c.d(4, '09:05'),
          text: `Hi Alex, of course. I'll have Ray from Delgado Plumbing stop by. He'll reach out to schedule. Thanks for renewing, you've been a great tenant.

Gerald`,
        },
      ],
    },
    {
      id: 't-ceiling-stain',
      subject: 'Stain on the bathroom ceiling',
      labels: [...PRIMARY],
      messages: [
        {
          from: alex,
          to: [P.landlord],
          at: c.d(16, '08:12'),
          text: `Hi Gerald,

There's a brown stain on the bathroom ceiling that's gotten bigger over the last week. Photo attached. It's dry to the touch, but I think it might be coming from 4B upstairs.

I'm home after 5 most days if someone needs to take a look.

Thanks,
Alex`,
          attachments: [{ kind: 'png', filename: 'bathroom-ceiling.png', scene: ceilingStain(), size: 1_545_216 }],
        },
        {
          from: P.landlord,
          to: [alex],
          at: c.d(16, '11:30'),
          text: `Thanks for the photo, Alex. It was a slow leak from 4B's tub. Fixed this morning. Ray will come by Thursday at 5:30 to patch and paint the ceiling.`,
        },
      ],
    },
    {
      id: 't-plumber',
      subject: 'Bathroom fan, unit 3B',
      labels: [...PRIMARY],
      unread: 1,
      messages: [
        {
          from: P.plumber,
          to: [alex],
          cc: [P.landlord],
          at: c.h(22),
          text: `Hi Alex, Ray from Delgado Plumbing. Gerald asked me to look at your bathroom fan. I can come Monday between 9 and 11 or Wednesday after 4. Which is better?

Ray`,
        },
      ],
    },
    {
      id: 't-clinic',
      subject: `Appointment confirmed: ${formatWeekdayDate(appt)} at 8:40 AM`,
      labels: [...PRIMARY],
      unread: 1,
      messages: [
        {
          from: P.clinic,
          to: [alex],
          at: c.h(11),
          text: `Hi Alex,

Your appointment is confirmed.

Who: Dr. Helen Okoro, Family Medicine
When: ${formatWeekdayDate(appt)} at 8:40 AM
Where: Riverside Family Health, 2200 Harbor Blvd, Suite 300

Please arrive 10 minutes early and bring your insurance card. If you need to cancel or reschedule, call us at least 24 hours ahead.

Reply C to confirm or R to reschedule.

Riverside Family Health`,
        },
      ],
    },
    {
      id: 't-contract-sign',
      subject: 'Marisol Ortega sent you a document to sign: Freelance Design Agreement',
      labels: [...PRIMARY, 'IMPORTANT'],
      unread: 1,
      messages: [
        {
          from: P.signpost,
          to: [alex],
          replyTo: [P.marisol],
          at: c.h(13),
          text: `Marisol Ortega (Halcyon Studio) sent you a document to review and sign.

Freelance Design Agreement, Halcyon Studio x Alex Rivera

Message from Marisol: "Here's the contract we talked about. Take your time, and flag anything that looks off."

Review and sign: https://signpost.example/s/7Q2KX9

This link expires in 14 days. If you weren't expecting this, you can ignore this email.

SignPost, secure e-signatures`,
          attachments: [
            {
              kind: 'pdf',
              filename: 'Freelance Design Agreement, Halcyon Studio.pdf',
              size: 288_768,
              lines: [
                { text: 'Freelance Design Agreement', size: 20, bold: true },
                { text: 'Between Halcyon Studio ("Client") and Alex Rivera ("Designer")', gap: 8 },
                { text: '1. Scope', bold: true, gap: 16 },
                { text: 'Brand identity refresh: logo refinement, color system, and a 20 page guideline.' },
                { text: '2. Timeline', bold: true, gap: 10 },
                { text: 'Six weeks from signature, delivered in three milestones.' },
                { text: '3. Fees', bold: true, gap: 10 },
                { text: '$9,600 total, paid in three installments of $3,200 at each milestone.' },
                { text: '4. Ownership', bold: true, gap: 10 },
                { text: 'Client owns final deliverables on full payment. Designer may show work in a portfolio.' },
                { text: '5. Revisions', bold: true, gap: 10 },
                { text: 'Two rounds of revisions per milestone are included.' },
                { text: 'Signed: ______________________  Date: __________', gap: 36 },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 't-marisol',
      subject: 'Halcyon refresh, kickoff notes',
      labels: [...PRIMARY, L.sideProject],
      messages: [
        {
          from: P.marisol,
          to: [alex],
          at: c.d(9, '13:15'),
          text: `Hi Alex,

So nice to finally meet in person yesterday. Notes from our chat:

- We want the brand to feel calmer. Fewer colors, more space.
- Keep the heron. Everyone loves the heron. Lose the gradient.
- Budget is fine as discussed. I'll send the contract through SignPost this week.

Talk soon,
Marisol`,
        },
        {
          from: alex,
          to: [P.marisol],
          at: c.d(9, '17:50'),
          text: `Lovely to meet you too, Marisol. Agree on all three, and the heron is safe with me. Looking forward to the contract.`,
        },
      ],
    },
    {
      id: 't-recruiter',
      subject: 'Lead Product Designer at Quillstone',
      labels: [...PRIMARY],
      messages: [
        {
          from: P.recruiter,
          to: [alex],
          at: c.d(10, '15:00'),
          text: `Hi Alex,

I came across your work on the Fernwork onboarding redesign and was really impressed. I'm hiring a Lead Product Designer at Quillstone, a Series B company building tools for independent bookstores.

Remote friendly, strong design culture, and a team of 6 designers. Would you be open to a 20 minute chat?

Best,
Imogen Hart
Talentloft`,
        },
        {
          from: alex,
          to: [P.recruiter],
          at: c.d(10, '19:30'),
          text: `Hi Imogen,

Thanks for reaching out, and for the kind words. I'm happy where I am right now, so I'll pass, but Quillstone sounds like a lovely company. Feel free to check in next year.

Best,
Alex`,
        },
      ],
    },
    {
      id: 't-vet',
      subject: 'Biscuit is due for her vaccines',
      labels: [...PRIMARY],
      messages: [
        {
          from: P.vet,
          to: [alex],
          at: c.d(12, '09:00'),
          text: `Hi Alex,

Our records show Biscuit is due for her annual vaccines (FVRCP and rabies) this month. Book online or call us at the front desk.

Give her a chin scratch from all of us!

Elm Street Vet`,
        },
      ],
    },
    {
      id: 't-trail-photos',
      subject: 'photos from the lake',
      labels: [...PRIMARY],
      messages: [
        {
          from: jordan,
          to: [alex, theo],
          at: c.d(20, '21:30'),
          text: `finally got these off my camera. the dusk one is my new lock screen, no notes`,
          attachments: [
            { kind: 'png', filename: 'lake-morning.png', scene: landscape('lake'), size: 4_718_592 },
            { kind: 'png', filename: 'ridge-dusk.png', scene: landscape('dusk'), size: 5_242_880 },
          ],
        },
        {
          from: alex,
          to: [jordan, theo],
          at: c.d(20, '22:02'),
          text: `these are unreal. framing the dusk one for the hallway`,
        },
      ],
    },
  ];
}
