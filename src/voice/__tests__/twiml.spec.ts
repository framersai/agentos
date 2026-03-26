/**
 * @fileoverview Unit tests for TwiML/XML generation helpers.
 *
 * Tests cover all five XML generators:
 * - {@link twilioConversationTwiml} -- Twilio `<Connect><Stream>` for media streams.
 * - {@link twilioNotifyTwiml} -- Twilio `<Say>...<Hangup/>` for one-shot TTS.
 * - {@link telnyxStreamXml} -- Telnyx `<Stream>` XML acknowledgment.
 * - {@link plivoStreamXml} -- Plivo `<Stream>` with bidirectional + keepCallAlive.
 * - {@link plivoNotifyXml} -- Plivo `<Speak>...<Hangup/>` for one-shot TTS.
 *
 * Each generator is tested for:
 * - Correct XML structure (declaration, element hierarchy).
 * - Correct attribute/content embedding.
 * - XSS/injection prevention via XML entity escaping.
 */

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

/** All five XML-sensitive characters that must be escaped. */
const SPECIAL = '<>&"\'';
/** Expected entity-escaped form of the special characters. */
const SPECIAL_ESCAPED = '&lt;&gt;&amp;&quot;&apos;';

// ---------------------------------------------------------------------------
// twilioConversationTwiml
// ---------------------------------------------------------------------------

describe('twilioConversationTwiml', () => {
  it('should produce a valid XML declaration with Response/Connect/Stream structure', () => {
    const xml = twilioConversationTwiml('wss://example.com/stream');
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Connect>');
    expect(xml).toContain('<Stream');
    expect(xml).toContain('/>');
  });

  it('should embed the stream URL in the url attribute', () => {
    const url = 'wss://example.com/stream';
    const xml = twilioConversationTwiml(url);
    expect(xml).toContain(`url="${url}"`);
  });

  it('should append the token as a query parameter when provided', () => {
    const xml = twilioConversationTwiml('wss://example.com/stream', 'my-token');
    expect(xml).toContain('url="wss://example.com/stream?token=my-token"');
  });

  it('should not include a query string when no token is provided', () => {
    const xml = twilioConversationTwiml('wss://example.com/stream');
    expect(xml).not.toContain('?token=');
  });

  it('should XML-escape special characters in the URL to prevent injection', () => {
    // An ampersand in a query string must be entity-encoded in XML attributes.
    const xml = twilioConversationTwiml('wss://example.com/stream?a=1&b=2');
    expect(xml).toContain('&amp;');
    expect(xml).not.toMatch(/url="[^"]*&[^a]"?/); // Raw & should be encoded.
  });
});

// ---------------------------------------------------------------------------
// twilioNotifyTwiml
// ---------------------------------------------------------------------------

describe('twilioNotifyTwiml', () => {
  it('should produce a valid XML declaration with Response/Say/Hangup structure', () => {
    const xml = twilioNotifyTwiml('Hello caller');
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Say');
    expect(xml).toContain('<Hangup/>');
  });

  it('should include the text content inside the Say element', () => {
    const xml = twilioNotifyTwiml('Hello caller');
    expect(xml).toContain('>Hello caller<');
  });

  it('should add the voice attribute when a voice name is provided', () => {
    const xml = twilioNotifyTwiml('Hi', 'Polly.Joanna');
    expect(xml).toContain('voice="Polly.Joanna"');
  });

  it('should omit the voice attribute when no voice is provided', () => {
    const xml = twilioNotifyTwiml('Hi');
    expect(xml).not.toContain('voice=');
  });

  it('should XML-escape special characters in the text content to prevent injection', () => {
    const xml = twilioNotifyTwiml(SPECIAL);
    expect(xml).toContain(SPECIAL_ESCAPED);
    expect(xml).not.toContain(SPECIAL);
  });

  it('should XML-escape special characters in the voice attribute value', () => {
    const xml = twilioNotifyTwiml('Hi', 'voice"<>');
    expect(xml).not.toContain('voice"<>');
    expect(xml).toContain('&quot;');
  });
});

// ---------------------------------------------------------------------------
// telnyxStreamXml
// ---------------------------------------------------------------------------

describe('telnyxStreamXml', () => {
  it('should produce a valid XML declaration with Response/Stream structure', () => {
    const xml = telnyxStreamXml('wss://example.com/telnyx');
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Stream');
  });

  it('should embed the stream URL in the url attribute', () => {
    const xml = telnyxStreamXml('wss://example.com/telnyx');
    expect(xml).toContain('url="wss://example.com/telnyx"');
  });

  it('should XML-escape special characters in the URL to prevent injection', () => {
    const xml = telnyxStreamXml('wss://example.com/stream?a=1&b=2');
    expect(xml).toContain('&amp;');
  });
});

// ---------------------------------------------------------------------------
// plivoStreamXml
// ---------------------------------------------------------------------------

describe('plivoStreamXml', () => {
  it('should produce a valid XML declaration with Response/Stream structure', () => {
    const xml = plivoStreamXml('wss://example.com/plivo');
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Stream');
    expect(xml).toContain('</Stream>');
  });

  it('should set bidirectional="true" and keepCallAlive="true" attributes', () => {
    const xml = plivoStreamXml('wss://example.com/plivo');
    expect(xml).toContain('bidirectional="true"');
    expect(xml).toContain('keepCallAlive="true"');
  });

  it('should place the stream URL as element text content (not as an attribute)', () => {
    // Plivo's <Stream> element takes the URL as inner text, not an `url` attribute.
    const url = 'wss://example.com/plivo';
    const xml = plivoStreamXml(url);
    expect(xml).toContain(`>${url}<`);
  });

  it('should XML-escape special characters in the URL to prevent injection', () => {
    const xml = plivoStreamXml('wss://example.com/stream?a=1&b=2');
    expect(xml).toContain('&amp;');
  });
});

// ---------------------------------------------------------------------------
// plivoNotifyXml
// ---------------------------------------------------------------------------

describe('plivoNotifyXml', () => {
  it('should produce a valid XML declaration with Response/Speak/Hangup structure', () => {
    const xml = plivoNotifyXml('Hello from Plivo');
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<Response>');
    expect(xml).toContain('<Speak');
    expect(xml).toContain('<Hangup/>');
  });

  it('should include the text content inside the Speak element', () => {
    const xml = plivoNotifyXml('Hello from Plivo');
    expect(xml).toContain('>Hello from Plivo<');
  });

  it('should add the voice attribute when a voice name is provided', () => {
    const xml = plivoNotifyXml('Hi', 'WOMAN');
    expect(xml).toContain('voice="WOMAN"');
  });

  it('should omit the voice attribute when no voice is provided', () => {
    const xml = plivoNotifyXml('Hi');
    expect(xml).not.toContain('voice=');
  });

  it('should XML-escape special characters in the text content to prevent injection', () => {
    const xml = plivoNotifyXml(SPECIAL);
    expect(xml).toContain(SPECIAL_ESCAPED);
    expect(xml).not.toContain(SPECIAL);
  });

  it('should XML-escape special characters in the voice attribute value', () => {
    const xml = plivoNotifyXml('Hi', 'voice"<>');
    expect(xml).not.toContain('voice"<>');
    expect(xml).toContain('&quot;');
  });
});
