# 百度网盘 OAuth 配置指南

## 概述

本应用已实现百度网盘的 OAuth 2.0 授权流程，用户无需手动填写 Client ID 和 Client Secret，只需点击登录按钮即可完成授权。

## 实现原理

- **标准 OAuth 2.0 授权码模式**: 使用标准的授权码流程（不支持 PKCE）
- **本地回调服务器**: 在随机端口（49152-65535）启动临时 HTTP 服务器接收 OAuth 回调
- **自动浏览器打开**: 使用系统默认浏览器打开百度网盘授权页面
- **Token 管理**: 自动管理 access token 和 refresh token，并在过期前自动刷新

## 配置步骤

### 1. 获取密钥信息

您已经获取了以下密钥信息：
- **AppKey (Client ID)**: `V0HWbaeKaFlqVPbGKcb5rizvRKJnMyHk`
- **SecretKey (Client Secret)**: `4CeEL1iX5rAvvaH6kKDZ3DcxjnQZ5N1u`
- **SignKey**: `CCriZoX#8+GZ3wZo2Gi52=Tw^@3o-^QN` (用于签名，OAuth 流程中主要使用前两个)

### 2. 配置环境变量

密钥已自动配置到 `.env` 文件中：
```env
BAIDU_CLIENT_ID=V0HWbaeKaFlqVPbGKcb5rizvRKJnMyHk
BAIDU_CLIENT_SECRET=4CeEL1iX5rAvvaH6kKDZ3DcxjnQZ5N1u
```

### 3. 配置授权回调地址（重要）

由于应用使用随机端口（49152-65535），您需要在百度网盘开放平台配置回调地址：

1. 访问 [百度网盘开放平台控制台](https://pan.baidu.com/union/console/applist)
2. 找到您的应用（AppKey: `V0HWbaeKaFlqVPbGKcb5rizvRKJnMyHk`）
3. 进入应用设置，找到"授权回调地址"或"Redirect URI"配置项
4. 配置以下回调地址（根据百度网盘的要求选择一种方式）：

   **方式一：配置多个端口范围**（如果支持）
   ```
   http://127.0.0.1:49152
   http://127.0.0.1:49153
   ...
   http://127.0.0.1:65535
   ```
   > 注意：这种方式需要配置大量地址，可能不实用

   **方式二：配置通配符**（如果支持）
   ```
   http://127.0.0.1:*
   ```
   > 注意：百度网盘可能不支持通配符

   **方式三：使用固定端口**（推荐，如果百度网盘要求固定地址）
   - 如果百度网盘要求固定回调地址，可以修改代码使用固定端口（例如 49152）
   - 或者配置一个固定的回调地址，然后手动处理重定向

   **方式四：使用 oob（Out-of-Band）模式**（如果支持）
   ```
   oob
   ```
   > 注意：这种方式会在授权页面直接显示授权码，需要手动复制

### 4. 测试授权流程

1. 重新编译应用（确保环境变量已加载）
2. 打开应用，进入云存储设置
3. 选择"百度网盘"
4. 点击"使用百度网盘登录"按钮
5. 浏览器会自动打开百度网盘授权页面
6. 登录并授权后，浏览器会重定向到本地回调地址
7. 授权成功后，应用会显示用户信息和存储配额

## 常见问题

### Q: 授权时提示"redirect_uri 不匹配"？

**A:** 这表示回调地址配置不正确。请检查：
1. 百度网盘开放平台中配置的回调地址是否包含应用实际使用的地址
2. 回调地址格式是否正确（例如：`http://127.0.0.1:49152`）
3. 如果使用随机端口，可能需要配置多个地址或联系百度网盘技术支持

### Q: 如何查看应用实际使用的回调地址？

**A:** 查看应用日志输出，会显示类似以下信息：
```
本地回调服务器已启动，端口: 49152
回调 URL: http://127.0.0.1:49152
```

### Q: Token 过期后如何刷新？

**A:** 应用会自动在 token 过期前 5 分钟刷新。如果刷新失败，需要重新授权。

### Q: 如何撤销授权？

**A:** 在应用设置中点击"断开连接"按钮，或者在百度网盘开放平台中撤销应用授权。

## 技术细节

### OAuth 流程

1. **授权请求**: 应用打开浏览器，跳转到百度网盘授权页面
   ```
   https://openapi.baidu.com/oauth/2.0/authorize?response_type=code&client_id=...&redirect_uri=...&scope=netdisk&state=...
   ```

2. **用户授权**: 用户在浏览器中登录并授权

3. **获取授权码**: 百度网盘重定向到本地回调地址，携带授权码
   ```
   http://127.0.0.1:49152/?code=xxx&state=xxx
   ```

4. **交换 Token**: 应用使用授权码换取 access_token 和 refresh_token
   ```
   https://openapi.baidu.com/oauth/2.0/token?grant_type=authorization_code&code=xxx&client_id=...&client_secret=...&redirect_uri=...
   ```

5. **获取用户信息**: 使用 access_token 获取用户信息
   ```
   https://openapi.baidu.com/rest/2.0/passport/users/getInfo?access_token=...
   ```

6. **获取存储配额**: 使用 access_token 获取网盘容量信息
   ```
   https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo&access_token=...
   ```

### Token 有效期

- **Access Token**: 30 天
- **Refresh Token**: 10 年
- 应用会在 token 过期前 5 分钟自动刷新

## 相关资源

- [百度网盘开放平台文档](https://pan.baidu.com/union/doc/)
- [OAuth 接入指南](https://openauth.baidu.com/doc/doc.html)
- [授权码模式授权](https://pan.baidu.com/union/doc/al0rwqzzl)

## 支持

如有问题，请查看：
1. 应用日志（Tauri devtools）
2. 浏览器控制台错误
3. 百度网盘开放平台错误日志
