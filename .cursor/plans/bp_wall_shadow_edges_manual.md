# 窗框四邊長度影子 — 手動接線（BP_WallShadowLogic）

MCP 自動寫入需 **Unreal Editor 已開啟 + ue-mcp 連線**。若失敗，照此文件在編輯器操作。

---

## 一、新增變數

| 名稱 | 型別 | 預設 |
|------|------|------|
| **Edge Lengths** | **Float**、**Array**、長度 **4** | 0,0,0,0 |

---

## 二、BeginPlay：算四條邊長（A→B、B→C、C→D、D→A）

`Light Through Points` 順序必須繞窗一圈：**0=A, 1=B, 2=C, 3=D**。

```text
Event BeginPlay
  → For Loop（First 0, Last 3）
      Loop Index = SideIndex
      NextIndex = (SideIndex + 1) % 4    （用 Add + Percent Int % 4）

      LocA = Get World Location( Light Through Points[SideIndex] )
      LocB = Get World Location( Light Through Points[NextIndex] )
      Dist = Vector Length(LocB - LocA)   或 Vector Distance

      Set Array Elem：Edge Lengths[SideIndex] = Dist
```

---

## 三、函式 `ApplyShadowAlongEdge`（建議）

**輸入：**

- `SideIndex` (Integer)
- `Target Root` (Scene Component)
- `Target Collider` (Box Component)

**邏輯：**

```text
NextIndex = (SideIndex + 1) % 4
LocA = GET Light Through Points[SideIndex] → World Location
LocB = GET Light Through Points[NextIndex] → World Location
Dist = Edge Lengths[SideIndex]   （或現算 Distance）

Mid = (LocA + LocB) * 0.5
Rot = Find Look at Rotation(Start=LocA, Target=LocB)

Set World Location(Target Root, Mid)
Set World Rotation(Target Root, Rot)

Half = Dist / 2
Make Vector(X=Origin Collision Size.X, Y=Half, Z=Origin Collision Size.Z)
  → Set Box Extent(Target Collider)

Set Collision Enabled(Target Collider, Query Only)
```

**不要** 把 Hit Location 接到 Set Box Extent。

---

## 四、接到你的 3 球 × 4 邊

更新影子時（`Shadow Collision Compute` 或自訂事件）：

```text
SideIndex = 0～3  （For Loop）
BallIndex = 0～2
SlotIndex = SideIndex * 3 + BallIndex

GET Shadow Roots[SlotIndex]  → Target Root
GET Shadow Colliders[SlotIndex] → Target Collider
GET Active Ball[BallIndex] → Ball（Cast 後接 Compute 的 Ball）

Call ApplyShadowAlongEdge(SideIndex, Target Root, Target Collider)
→ 再跑 Line Trace（Ball 有效時）等原有邏輯
```

`Shadow Collision Compute` 需有輸入腳：

- **Ball**（Actor）← 必須接，避免 None
- **SideIndex**（Integer）← 新增
- **Target Root**、**Target Collider**、**Light Point**（若射線仍用）

---

## 五、自動化腳本（編輯器內）

1. 開啟專案，打開 `BP_WallShadowLogic`
2. **Tools → Execute Python Script**
3. 選：`implement_wall_window_edges.py`
4. Compile → Save
5. 檢查 `Shadow Collision Compute` 左側是否多出邊長節點；**斷開** Hit Location → Set Box Extent

---

## 六、測試

1. PIE，窗內 1 顆球 → 4 條邊影子長度應約等於相鄰兩角距離  
2. 旋轉窗框 Actor 後，重新進 Play（BeginPlay 會重算 Edge Lengths）
