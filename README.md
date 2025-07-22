# AI課題プランナー

Created with CodeSandbox

## 概要

「課題に追われる毎日。でも本当はもっと遊びたい…」

そんな悩みを解決するために、AIがあなたの生活リズムを学習し、最も集中できる時間帯に課題をスケジューリングするWebアプリを開発しました。
強化学習（多腕バンディット問題）を用いることで、使えば使うほどあなたに最適化された「パーソナルスケジューラー」へと成長します。

## 使用技術

-   **フロントエンド**: React
-   **バックエンド**: Python, Flask
-   **インフラ**: Firebase (認証), Google Calendar API

#### 前提条件
-   Node.js (v18以上推奨)
-   Python (v3.10以上推奨)

#### リポジトリのクローン
```
git clone https://github.com/kaimu134383431/time-scheduler-test.git
```
#### バックエンドサーバー

**serverフォルダに移動**
```
cd server
```

**仮想環境の作成**
```
python -m venv venv
```

**仮想環境の有効化 (Windows PowerShellの場合)**
```
.\venv\Scripts\activate
```
**(Mac/Linuxの場合は source venv/bin/activate)**

**依存関係のインストール**
```
pip install -r requirements.txt
```

**起動 仮想環境が有効化されていることを確認 (行頭に(venv)と表示)**
```
python server.py
```

#### フロントエンドサーバー

**clientフォルダに移動 (プロジェクトのルートから)**
```
cd client
```

**依存関係のインストール**
```
npm install
```

**起動**
```
npm start
```
