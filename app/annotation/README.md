# 标注套件

用于产出「人工编码一致性」这一证据。三个数字都从这里出：8 码 κ、5 类对标 κ、单类 κ。

## 目录

```
annotation/
├── corpus/                     ← 把你的试讲转写稿放这里（.txt / .md / .srt / .vtt / .json）
├── set-<n>.csv                 抽样结果（含 A / B 空列，给 Excel 用）
├── set-<n>-label.html          离线标注页（双击打开，不显示系统判断）
├── set-<n>-report.md           抽样报告（记录了种子，可复现同一批句子）
└── selftest/                   自检数据 —— 不是研究数据，见该目录 README
```

## 三步（有录音的话，前面再加一步 ⓪）

```bash
# ⓪ 录音 → 语料：批量转写（本地 offline whisper，不出网、不花钱）
npm run corpus:transcribe -- --dir "D:/录音/试讲"        # 或直接给文件路径
npm run corpus:transcribe -- --check                    # 只检测环境，不转写

# ① 抽样：从语料里抽 200 句，按规则编码分层
npm run corpus:sample                                  # = 下面这条
node scripts/build-annotation-set.js --input annotation/corpus --n 200

# ② 两人各自打开 set-200-label.html 标注（互不交流），导出 annotator-A.csv / annotator-B.csv
#    首轮只标前 20 句即可，先看 κ 能不能过 0.60

# ③ 算一致性
node scripts/cohen-kappa.js --a annotation/annotator-A.csv --b annotation/annotator-B.csv \
    --limit 20 --out annotation/kappa-trial.md          # 试标

node scripts/cohen-kappa.js --a annotation/annotator-A.csv --b annotation/annotator-B.csv \
    --out annotation/kappa-final.md                     # 正式
```

### 关于 ⓪ 的三条约定

- `.txt` 里**只有纯转写**，元信息全部写进 `corpus/manifest.json`。切句器不认表头，混进去就是数据污染。
- 同名 `.txt` 默认**拒绝覆盖**，要重跑加 `--force`。真实录音的转写成本高，误覆盖等于丢数据。
- 空转写（静音段、纯环境音）**不落盘也不报错**，只记进 manifest 的 `empty` 数组。真实课堂里静音是正常现象，把它当失败会让人误判工具坏了。

## 三条不能省的事

1. **标注前必须读《docs/iFIAS标注手册.md》。** 不读手册直接标，κ 反映的是"两个人各自的经验"，不是编码体系。
2. **标注期间不许讨论具体句子，只能讨论手册条文。** 讨论过的句子作废重标。
3. **首轮 κ < 0.60 就停下来修手册**，不要硬标完。标完再返工的成本是首轮的三倍。

## 语料要求

- 单份 **1500 字以上**的试讲转写稿，或 3–5 份拼接。低于 1000 字抽不满 200 句。
- 保留口语原样，**不要清洗**。"嗯""那个""好"这些是反馈类编码的证据，删掉就等于篡改了数据。
- 有学生发言就保留 `生：` 标记，没有也不影响（单方稿的学生类天然为 0，报告里会说明）。

## 这份数据能证明什么、不能证明什么

| 能 | 不能 |
| :-- | :-- |
| 两名标注员按同一手册能否标出同样结果（一致性） | 编码体系本身是否有效（效度） |
| 机器编码与人工金标准差多少（把 `final` 列当金标准） | 教学质量好坏 |
| 哪几类判据需要重写（看混淆矩阵） | 系统对真实课堂的适用性（语料是试讲稿） |

**κ 只说明一致性，不说明正确性。** 两名标注员可能一致地错——这就是为什么还要用 `final` 列做仲裁，以及为什么机器编码要单独评测。
