export function concatFloat32AudioFrames(frames) {
    const totalLength = frames.reduce((sum, frame) => sum + frame.length, 0);
    const output = new Float32Array(totalLength);
    let offset = 0;
    for (const frame of frames) {
        output.set(frame, offset);
        offset += frame.length;
    }
    return output;
}
function clampPcm16(sample) {
    const value = Math.max(-1, Math.min(1, sample));
    return value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff);
}
export function encodeFloat32ToWav(input, sampleRate, channelCount = 1) {
    const audio = input instanceof Float32Array ? input : concatFloat32AudioFrames(input);
    const pcmData = Buffer.alloc(audio.length * 2);
    for (let index = 0; index < audio.length; index += 1) {
        pcmData.writeInt16LE(clampPcm16(audio[index] ?? 0), index * 2);
    }
    const header = Buffer.alloc(44);
    const byteRate = sampleRate * channelCount * 2;
    const blockAlign = channelCount * 2;
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmData.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channelCount, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcmData.length, 40);
    return Buffer.concat([header, pcmData]);
}
//# sourceMappingURL=audio.js.map