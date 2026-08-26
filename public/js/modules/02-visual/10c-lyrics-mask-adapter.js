/**
 * P1 双管线适配器：功能开关只选路径，不靠 XOR 覆盖全局符号。
 * - Legacy：makeLyricMaskLegacy / makeLyricShaderMaterialLegacy（10）
 * - Payload：makeLyricMaskPayload / makeLyricShaderMaterialRowLayers（10b/11）
 * makeLyricMask / makeLyricShaderMaterial 统一分发，供 buildLyricMesh / row-layers / legacy 共用。
 */
function makeLyricMask(input, layoutOverride) {
  if (input && typeof input === 'object') {
    if (typeof makeLyricMaskPayload === 'function') {
      return makeLyricMaskPayload(input, layoutOverride);
    }
    var textFromObj = '';
    if (typeof normalizeStageLyricPayload === 'function') {
      var payload = normalizeStageLyricPayload(input);
      textFromObj = payload && payload.combinedText ? payload.combinedText : (payload && payload.text) || '';
    } else {
      textFromObj = String((input && (input.text || input.combinedText)) || '');
    }
    return makeLyricMaskLegacy(textFromObj);
  }
  return makeLyricMaskLegacy(String(input == null ? '' : input));
}

function makeLyricShaderMaterial(mask, pal, motionProfile) {
  if (typeof makeLyricShaderMaterialRowLayers === 'function') {
    return makeLyricShaderMaterialRowLayers(
      mask,
      pal,
      motionProfile || (typeof lyricMotionProfile === 'function' ? lyricMotionProfile() : undefined)
    );
  }
  return makeLyricShaderMaterialLegacy(mask, pal);
}
