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
          removeHiddenElems: false
        }
      }
    }
  ]
};
