const assert = require('node:assert/strict');
const test = require('node:test');

const mp = require('../cloudbase/functions/nihaixia-qa-mp');
const router = require('../cloudbase/functions/nihaixia-qa-router');

const MULTI_CONCEPT_QUESTION = '经方、针灸、本草在学习路径中分别承担什么作用？';

test('小程序和网页使用完全一致的回答契约与生成温度', () => {
  assert.equal(mp.MODEL_TEMPERATURE, router.MODEL_TEMPERATURE);
  assert.equal(
    mp.buildAnswerStyleInstruction(MULTI_CONCEPT_QUESTION),
    router.buildAnswerStyleInstruction(MULTI_CONCEPT_QUESTION),
  );
  assert.equal(
    mp.normalizeLearningClaims('急症优先用针灸，慢症优先用经方。'),
    router.normalizeLearningClaims('急症优先用针灸，慢症优先用经方。'),
  );
});

test('输出净化将建议化临床表述改为资料观点', () => {
  const output = mp.normalizeLearningClaims('资料中提及“急症先用针灸”属于体系内观点。');

  assert.doesNotMatch(output, /急症先用|慢症用/);
  assert.equal(output, '资料中的相关应用内容仅作学习讨论，不构成实际治疗建议。');

  const missingMiddle = mp.normalizeLearningClaims('资料提及“急症先用针灸，并非实际治疗建议。');
  assert.equal(missingMiddle, '资料中的相关应用内容仅作学习讨论，不构成实际治疗建议。');

  const direct = mp.normalizeLearningClaims('急症先用针灸，慢症用经方。');
  assert.doesNotMatch(direct, /急症先用|慢症用/);
  assert.match(direct, /资料中的相关学习观点/);

  const nested = mp.normalizeLearningClaims('资料中提及“资料中的相关应用讨论（仅供学习，不构成实际治疗建议），并非实际治疗建议。');
  assert.equal(nested, '资料中的相关应用内容仅作学习讨论，不构成实际治疗建议。');
});

test('多概念学习问题要求逐项覆盖、总结和安全措辞', () => {
  const instruction = mp.buildAnswerStyleInstruction(MULTI_CONCEPT_QUESTION);

  assert.deepEqual(mp.getExpectedConcepts(MULTI_CONCEPT_QUESTION), ['经方', '针灸', '本草']);
  assert.match(instruction, /必须分别覆盖：经方、针灸、本草/);
  assert.match(instruction, /学习定位、核心学习重点、与其他概念的关系/);
  assert.match(instruction, /组合关系/);
  assert.match(instruction, /500-900/);
  assert.match(instruction, /不输出针对个人的诊断、处方、剂量/);
});

test('简单定义问题也遵守独立回答和学习安全边界', () => {
  const instruction = router.buildAnswerStyleInstruction('什么是太阳病？');

  assert.match(instruction, /当前问题必须独立、完整回答/);
  assert.match(instruction, /只使用知识库能够支持的内容/);
  assert.doesNotMatch(instruction, /本题必须分别覆盖：/);
});
