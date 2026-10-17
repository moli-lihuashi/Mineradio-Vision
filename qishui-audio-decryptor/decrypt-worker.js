// 汽水加密音频解密 worker：把 CPU 密集的逐样本 AES 解密从主进程事件循环里挪走，
// 避免阻塞 UI（卡顿）并在独立堆里跑，降低主进程内存尖峰导致整 app 崩溃的概率。
// 纯计算，无副作用；出错也一定回一条消息，绝不让主进程挂起。
const { parentPort } = require('worker_threads');
const { TrackDecryptor } = require('./track-decryptor');

const decryptor = new TrackDecryptor();

if (parentPort) {
  parentPort.on('message', (msg) => {
    const id = msg && msg.id;
    try {
      const enc = msg.encryptedBuffer;
      // 主进程 transfer 过来的 ArrayBuffer，用零拷贝视图（不再复制一份）
      const encryptedBuffer = enc && enc.buffer
        ? Buffer.from(enc.buffer, enc.byteOffset || 0, enc.byteLength != null ? enc.byteLength : enc.length)
        : Buffer.from(enc);
      const result = decryptor.decrypt({ encryptedBuffer, spadeA: msg.spadeA });
      const out = result && result.buffer;
      if (!Buffer.isBuffer(out) || out.length === 0) {
        throw new Error('decrypt produced empty buffer');
      }
      const reply = { id, ok: true, buffer: out, extension: result.extension };
      try {
        // 大文件（非池化、byteOffset=0）可零拷贝 transfer；小 buffer 可能来自共享池不可 transfer
        parentPort.postMessage(reply, [out.buffer]);
      } catch (transferErr) {
        parentPort.postMessage(reply);
      }
    } catch (err) {
      parentPort.postMessage({
        id,
        ok: false,
        error: (err && err.message) || String(err),
      });
    }
  });
}
