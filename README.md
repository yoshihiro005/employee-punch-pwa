# 社員打刻PWA

スマホのホーム画面に追加して使える、シンプルな社員打刻Webアプリです。

## 起動方法

```bash
npm install
npm start
```

ブラウザで `http://localhost:3000` を開きます。

## 初期データ

- 社員ID: `1001` / `1002` / `1003`
- 初期個人PIN: 社員IDと同じ番号
- 管理者PIN: `2468`

管理者PINは環境変数で変更できます。

```powershell
$env:ADMIN_PIN="9999"
npm.cmd start
```

## 主な機能

- PWA対応
- 社員ID + 個人PINログイン
- 端末ごとの社員ログイン記憶
- 出勤・退勤打刻
- 同日2回打刻の防止
- 社員本人による月次出退勤確認と修正
- 修正時の修正印自動刻印
- 管理者による社員ID・氏名・個人PIN・有効状態の管理
- 管理者による打刻修正・追加
- 修正履歴のDB保存
- 日付・社員検索
- 毎月21日から翌月20日までの20日締め集計
- CSV出力
- 20日締め集計CSVの指定フォルダ保存

## データ保存先

SQLiteデータベースは `data/attendance.sqlite` に作成されます。

## 集計CSVのフォルダ保存

管理者画面の「集計」タブで月を選び、「フォルダを選択」ボタンから保存先フォルダを選ぶとCSVを保存できます。

ブラウザがフォルダ選択に対応していない場合は、保存先フォルダを入力して保存します。

初期値は `C:\勤怠CSV` です。

```powershell
$env:EXPORT_DIR="C:\勤怠CSV"
npm.cmd start
```

## 登録者・打刻データが初期化されないための保存先

社員登録、PIN、打刻履歴、修正履歴はSQLiteデータベースに保存されます。

現在の標準保存先は、アプリのGitHubフォルダ内ではなく、Windowsのユーザーデータ領域です。

```text
%LOCALAPPDATA%\employee-punch-pwa\attendance.sqlite
```

そのため、GitHubからアプリ本体を更新しても、登録者や打刻データは残ります。

以前の保存先 `data/attendance.sqlite` が残っていて、新しい保存先にDBがまだ無い場合は、起動時に自動で新しい保存先へコピーします。

保存先を明示したい場合は、起動前に `DB_PATH` を指定できます。

```powershell
$env:DB_PATH="C:\勤怠データ\attendance.sqlite"
npm.cmd start
```

バックアップする場合は、この `attendance.sqlite` をコピーしてください。
