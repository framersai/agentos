import { describe, it, expect } from 'vitest';
import {
  twilioConversationTwiml,
  twilioNotifyTwiml,
  telnyxStreamXml,
  plivoStreamXml,
  plivoNotifyXml,
} from '../twiml.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPECIAL = '<>&"\'';
const SPECIAL_ESCAPED = '&lt;&gt;&amp;&quot;&apos;';

// ---------------------------------------------------------------------------
// twilioConversationTwiml
// ---------------------------------------------------------------------------

describe('twilioConversationTwiml', () => {
  it('produces a valid XML declaration and Response/Connect/Stream structure', () => {
    const xml = twilioConversationTwiml('wss://example.com/stream');
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Connect>');
    expect(xml).toContain('<Stream');
    expect(xml).toContain('/>');
  });

  it('embeds the stream URL in the url attribute', () => {
    const url = 'wss://example.com/stream';
    const xml = twilioConversationTwiml(url);
    expect(xml).toContain(`url="${url}"`);
  });

  it('appends the token as a query parameter when provided', () => {
    const xml = twilioConversationTwiml('wss://example.com/stream', 'my-token');
    expect(xml).toContain('url="wss://example.com/stream?token=my-token"');
  });

  it('does not include a query string when no token is provided', () => {
    const xml = twilioConversationTwiml('wss://example.com/stream');
    expect(xml).not.toContain('?token=');
  });

  it('XML-escapes special characters in the URL', () => {
    // e.g. & in an existing query string
    const xml = twilioConversationTwiml('wss://example.com/stream?a=1&b=2');
    expect(xml).toContain('&amp;');
    expect(xml).not.toMatch(/url="[^"]*&[^a]"?/); // raw & should be encoded
  });
});

// ---------------------------------------------------------------------------
// twilioNotifyTwiml
// ---------------------------------------------------------------------------

describe('twilioNotifyTwiml', () => {
  it('produces a valid XML declaration and Response/Say/Hangup structure', () => {
    const xml = twilioNotifyTwiml('Hello caller');
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Say');
    expect(xml).toContain('<Hangup/>');
  });

  it('includes the text content inside Say', () => {
    const xml = twilioNotifyTwiml('Hello caller');
    expect(xml).toContain('>Hello caller<');
  });

  it('adds voice attribute when provided', () => {
    const xml = twilioNotifyTwiml('Hi', 'Polly.Joanna');
    expect(xml).toContain('voice="Polly.Joanna"');
  });

  it('omits voice attribute when not provided', () => {
    const xml = twilioNotifyTwiml('Hi');
    expect(xml).not.toContain('voice=');
  });

  it('XML-escapes special characters in text', () => {
    const xml = twilioNotifyTwiml(SPECIAL);
    expect(xml).toContain(SPECIAL_ESCAPED);
    expect(xml).not.toContain(SPECIAL);
  });

  it('XML-escapes special characters in the voice attribute', () => {
    const xml = twilioNotifyTwiml('Hi', 'voice"<>');
    expect(xml).not.toContain('voice"<>');
    expect(xml).toContain('&quot;');
  });
});

// ---------------------------------------------------------------------------
// telnyxStreamXml
// ---------------------------------------------------------------------------

describe('telnyxStreamXml', () => {
  it('produces a valid XML declaration and Response/Stream structure', () => {
    const xml = telnyxStreamXml('wss://example.com/telnyx');
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Stream');
  });

  it('embeds the stream URL in the url attribute', () => {
    const xml = telnyxStreamXml('wss://example.com/telnyx');
    expect(xml).toContain('url="wss://example.com/telnyx"');
  });

  it('XML-escapes special characters in the URL', () => {
    const xml = telnyxStreamXml('wss://example.com/stream?a=1&b=2');
    expect(xml).toContain('&amp;');
  });
});

// ---------------------------------------------------------------------------
// plivoStreamXml
// ---------------------------------------------------------------------------

describe('plivoStreamXml', () => {
  it('produces a valid XML declaration and Response/Stream structure', () => {
    const xml = plivoStreamXml('wss://example.com/plivo');
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Stream');
    expect(xml).toContain('</Stream>');
  });

  it('sets bidirectional and keepCallAlive attributes', () => {
    const xml = plivoStreamXml('wss://example.com/plivo');
    expect(xml).toContain('bidirectional="true"');
    expect(xml).toContain('keepCallAlive="true"');
  });

  it('places the stream URL as element text content', () => {
    const url = 'wss://example.com/plivo';
    const xml = plivoStreamXml(url);
    expect(xml).toContain(`>${url}<`);
  });

  it('XML-escapes special characters in the URL', () => {
    const xml = plivoStreamXml('wss://example.com/stream?a=1&b=2');
    expect(xml).toContain('&amp;');
  });
});

// ---------------------------------------------------------------------------
// plivoNotifyXml
// ---------------------------------------------------------------------------

describe('plivoNotifyXml', () => {
  it('produces a valid XML declaration and Response/Speak/Hangup structure', () => {
    const xml = plivoNotifyXml('Hello from Plivo');
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Speak');
    expect(xml).toContain('<Hangup/>');
  });

  it('includes the text content inside Speak', () => {
    const xml = plivoNotifyXml('Hello from Plivo');
    expect(xml).toContain('>Hello from Plivo<');
  });

  it('adds voice attribute when provided', () => {
    const xml = plivoNotifyXml('Hi', 'WOMAN');
    expect(xml).toContain('voice="WOMAN"');
  });

  it('omits voice attribute when not provided', () => {
    const xml = plivoNotifyXml('Hi');
    expect(xml).not.toContain('voice=');
  });

  it('XML-escapes special characters in text', () => {
    const xml = plivoNotifyXml(SPECIAL);
    expect(xml).toContain(SPECIAL_ESCAPED);
    expect(xml).not.toContain(SPECIAL);
  });

  it('XML-escapes special characters in the voice attribute', () => {
    const xml = plivoNotifyXml('Hi', 'voice"<>');
    expect(xml).not.toContain('voice"<>');
    expect(xml).toContain('&quot;');
  });
});
