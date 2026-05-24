# BP_WallShadowLogic：3 球 × 4 邊 = 12 影子（定稿）

> 完整版：`wall_shadow_4+12_f82e4fc9.plan.md`

## 規格

- 最多 **3** 球 × 每球 **4** 邊影子 = **12**
- `SlotIndex = SideIndex × 3 + BallIndex`
- 偵測：`Collision For All`（可保留 `Light Checkers` Gizmo Box 做別用）

## 既有變數（不用新建 ActiveBalls）

| 變數 | 用途 |
|------|------|
| **`Active Ball`**（BP_LightBall Array，**3 格**） | 球槽；**BallIndex = 陣列索引** |
| **`Light Through Points`** | `GET[SideIndex]` 射線起點 |
| **`Light Checkers`**（Gizmo Box Array） | 可保留；與球槽分開 |

## 要改的是邏輯

- [ ] `Active Ball` 長度 = **3**（Class Defaults）
- [ ] 每球只 **Update 4 段**（For Side 0～3），不是一次 12 段
- [ ] `SlotIndex = SideIndex*3 + BallIndex`，Light 用 **SideIndex** GET
- [ ] Set Array Elem 寫 `Active Ball`；停用舊 Slot Onwers(12) Add/Clear
- [ ] Shadow 陣列 12 格 + Compute 的 Light Point 輸入

## 流程

`Begin Overlap` → 寫入 `Active Ball[BallIndex]` → `Update Ball Shadows(Ball, BallIndex)`  
`End Overlap` → Reset 該球 4 段 → `Active Ball[BallIndex]=None`
