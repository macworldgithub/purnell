import { explicitRequestConfirmation } from './appointment-request.service';

describe('spoken request confirmation vocabulary', () => {
  const positive = [
    'Yes', 'Yes please', 'Yeah', 'Yep', 'Yup', 'Sure', 'Okay', 'OK',
    'Alright', 'All right', 'Absolutely', 'Certainly',
    'Ah. Yes, please, yes, proceed', 'Uh yes, please save',
    '[breath] Um, yes please save it for me.',
    'Go ahead', 'Please go ahead and save it', 'Go for it',
    'Do it please', 'Please proceed with the request',
    'Sounds good', 'Yes that works for me', "That's correct",
    "Yes, that's right", 'That is fine', "That's okay",
    'I agree', 'I confirm the request', 'Confirmed',
    'Save that', 'Save this request please', 'Save my request',
    'Yes please save the booking request',
    'Please save my appointment request', 'Yes and thank you',
    'Sure, yes, go ahead, thanks', 'Okay book that in',
  ];
  it.each(positive)('accepts an unchanged positive reply: %s', reply => {
    expect(explicitRequestConfirmation(reply)).toBe(true);
  });
  const negative = [
    '', 'Uh', '[cough]', 'Thanks', 'Please', 'Thank you',
    'No', 'No thanks', 'Do not save', "Don't save it", 'Yes but at six',
    'Okay not that date', 'Yes if it is free', 'Yes only if confirmed',
    'Maybe', 'Perhaps save it', 'I might confirm later',
    'Wait', 'Hold on', 'Sure change the registration',
    'Yes please save tomorrow', 'Yes please save at 5 pm',
    'Yes save it for KLP', 'Please save a different car',
    'I said yes earlier', 'Did you save it?', 'Can you save it?',
    'Can you confirm', 'Yes please save it?',
    'Yes after I check', 'Okay unless Service objects',
    'Yes yes no', 'Yes actually cancel', 'Book tomorrow',
    'Yes sounds good before I decide', 'yesplease',
  ];
  it.each(negative)('does not save an ambiguous, changed or negative reply: %s', reply => {
    expect(explicitRequestConfirmation(reply)).toBe(false);
  });
});
