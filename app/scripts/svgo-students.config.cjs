'use strict';

// 只压缩生成后的九张状态图，不改可编辑母版。
// 状态分组、ID 和 display 显隐是产品契约，不能按普通静态 SVG 清掉。
module.exports = {
  multipass: true,
  precision: 3,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          cleanupIds: false,
          collapseGroups: false,
          inlineStyles: false,
          removeDesc: false,
          removeHiddenElems: false,
          // convertTransform 会把「绕颈部旋转 + 下移」合并成等价的
          // rotate(5 185.481 387)，数字更难读、也让状态校验认不出低头姿态。
          // 留着原式，体积差可以忽略。
          convertTransform: false
        }
      }
    }
  ]
};
