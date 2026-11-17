import { foldedMessages } from '../../src/app/features/thread/fold';

const thread = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('folding the middle of a long conversation', () => {
  it('folds everything between the first message and the last two when only the last is open', () => {
    expect(foldedMessages(thread(8), (i) => i === 7)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps an open message in the middle on screen', () => {
    expect(foldedMessages(thread(8), (i) => i === 4)).toEqual([1, 2, 3]);
  });

  it('never folds a single message behind a "1 older messages" card', () => {
    expect(foldedMessages(thread(5), (i) => i === 2)).toEqual([]);
  });

  it('leaves short conversations alone', () => {
    expect(foldedMessages(thread(4), () => false)).toEqual([]);
  });
});
