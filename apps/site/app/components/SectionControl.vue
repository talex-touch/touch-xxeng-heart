<script setup lang="ts">
const scenarios = [
  {
    title: '默认启用',
    tone: 'on',
    rows: [
      ['普通网页', '按全局开关与域名规则运行'],
      ['GitHub 仓库', '提供项目速读'],
      ['Discourse 论坛', '提供主题摘要'],
    ],
  },
  {
    title: '内置停用',
    tone: 'off',
    rows: [
      ['学习通', 'chaoxing.com · xuexitong.com'],
      ['雨课堂', 'yuketang.cn · yuketang.com'],
    ],
  },
]
</script>

<template>
  <section class="section control">
    <div class="wrap">
      <div class="control__split">
        <div class="control__copy">
          <p class="eyebrow">
            你说了算
          </p>
          <h2 class="h2">
            能被关掉的辅助，才是好辅助。
          </h2>
          <p class="lead">
            替换密度、难度、单页上限、缓存周期和 AI 端点，每一项都能单独开启、关闭或清空。理析不替你决定读什么，也不替你决定学什么。
          </p>
          <ul class="control__points">
            <li v-for="p in ['按域名决定在哪些站点生效', '学习记录与缓存默认留在浏览器本地', 'AI 服务端点自行配置，随时更换或停用']" :key="p">
              <AppIcon name="check" :size="15" />{{ p }}
            </li>
          </ul>
        </div>

        <div class="mock settings">
          <div class="settings__head">
            <img src="/assets/icon.png" width="20" height="20" alt="" style="border-radius:6px">
            <span>设置</span>
            <span class="mono">v0.2.2</span>
          </div>

          <div class="settings__body">
            <div class="settings__row">
              <span class="settings__label">
                <b>在技术网页启用</b>
                <em>关闭后不替换、不划词翻译</em>
              </span>
              <span class="switch is-on" role="img" aria-label="已开启" />
            </div>

            <hr>

            <div class="settings__field">
              <p class="settings__fieldHead">
                <b>替换密度</b><span class="mono">13%</span>
              </p>
              <span class="slider" style="--v:13%" />
            </div>

            <div class="settings__field">
              <p class="settings__fieldHead">
                <b>基础难度</b><span class="mono">5 / 9</span>
              </p>
              <span class="slider" style="--v:56%" />
            </div>

            <div class="settings__row">
              <span class="settings__label"><b>划词自动翻译</b></span>
              <span class="switch is-on" role="img" aria-label="已开启" />
            </div>

            <div class="settings__row">
              <span class="settings__label">
                <b>页面自动摘要</b>
                <em>仅在你手动触发时运行</em>
              </span>
              <span class="switch" role="img" aria-label="已关闭" />
            </div>

            <hr>

            <div class="settings__field">
              <span class="settings__label">
                <b>AI 服务端点</b>
                <em>请求只发往你填写的地址</em>
              </span>
              <p class="settings__input mono">
                <span>https://api.your-provider.com/v1</span>
                <b aria-hidden="true">✓</b>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="scenarios">
        <div class="scenarios__head">
          <div>
            <h3 class="h3 scenarios__title">
              <span class="scenarios__shield" aria-hidden="true" />敏感场景，按站点明确控制。
            </h3>
            <p>理析内置学习通与雨课堂的停用策略。其他考试、支付、内网或管理系统可在设置中按域名加入黑名单。</p>
          </div>
          <p class="scenarios__note">
            域名规则可随时调整
          </p>
        </div>

        <div class="scenarios__cols">
          <div v-for="col in scenarios" :key="col.title" class="panel scenarios__col" :class="`is-${col.tone}`">
            <p class="scenarios__colHead">
              <i aria-hidden="true" />
              <b>{{ col.title }}</b>
              <span class="mono">{{ col.rows.length }} 类</span>
            </p>
            <hr>
            <ul>
              <li v-for="[name, ex] in col.rows" :key="name">
                <AppIcon :name="col.tone === 'on' ? 'check' : 'close'" :size="14" />
                <span>
                  <b>{{ name }}</b>
                  <em class="mono">{{ ex }}</em>
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.control__split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 560px);
  gap: clamp(36px, 6vw, 88px);
  align-items: center;
}

.control__copy {
  display: grid;
  gap: 24px;
}

.control__points {
  display: grid;
  gap: 14px;
}

.control__points li {
  display: flex;
  align-items: start;
  gap: 11px;
  font-size: 15px;
  line-height: 1.6;
}

.control__points svg {
  flex: none;
  margin-top: 3px;
  color: var(--accent);
}

/* --- settings mock --- */

.settings {
  border-radius: 20px;
}

.settings__head {
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--line);
  background: var(--bg-subtle);
  padding: 18px 22px;
  font-size: 14px;
  font-weight: 600;
}

.settings__head .mono {
  margin-left: auto;
  color: var(--ink-3);
  font-size: 11px;
  font-weight: 400;
}

.settings__body {
  display: grid;
  gap: 20px;
  padding: 22px;
}

.settings__body hr {
  margin: 0;
  border: 0;
  border-top: 1px solid var(--line);
}

.settings__row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.settings__label {
  flex: 1;
  min-width: 0;
}

.settings__label b {
  display: block;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.4;
}

.settings__label em {
  display: block;
  margin-top: 4px;
  color: var(--ink-3);
  font-size: 11.5px;
  font-style: normal;
  line-height: 1.4;
}

.switch {
  position: relative;
  width: 40px;
  height: 23px;
  flex: none;
  border-radius: var(--r-pill);
  background: var(--bg-muted);
}

.switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 19px;
  height: 19px;
  border-radius: 50%;
  background: var(--bg);
  box-shadow: 0 1px 3px rgb(13 13 13 / 0.16);
}

.switch.is-on {
  background: var(--accent);
}

.switch.is-on::after {
  left: auto;
  right: 2px;
}

.settings__field {
  display: grid;
  gap: 11px;
}

.settings__fieldHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 13.5px;
  font-weight: 500;
}

.settings__fieldHead .mono {
  color: var(--accent);
  font-size: 12px;
  font-weight: 400;
}

.slider {
  position: relative;
  display: block;
  height: 4px;
  border-radius: 2px;
  background: var(--bg-muted);
}

.slider::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--v);
  border-radius: 2px;
  background: var(--accent);
}

.slider::after {
  content: '';
  position: absolute;
  top: 50%;
  left: var(--v);
  width: 16px;
  height: 16px;
  transform: translate(-50%, -50%);
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  background: var(--bg);
  box-shadow: 0 1px 3px rgb(13 13 13 / 0.14);
}

.settings__input {
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--bg-subtle);
  padding: 11px 13px;
  color: var(--ink-2);
  font-size: 12px;
}

.settings__input span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings__input b {
  color: #12a150;
}

/* --- scenarios --- */

.scenarios {
  display: grid;
  gap: 34px;
  margin-top: clamp(48px, 6vw, 80px);
  border-radius: var(--r-lg);
  background: var(--bg-subtle);
  padding: clamp(24px, 3vw, 40px);
}

.scenarios__head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 40px;
}

.scenarios__title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.scenarios__shield {
  width: 14px;
  height: 16px;
  flex: none;
  background: var(--accent);
  clip-path: polygon(50% 0, 100% 22%, 100% 62%, 50% 100%, 0 62%, 0 22%);
}

.scenarios__head p {
  max-width: 42em;
  margin-top: 12px;
  color: var(--ink-2);
  font-size: 14.5px;
  line-height: 1.85;
}

.scenarios__note {
  flex: none;
  color: var(--ink-3);
  font-size: 12.5px;
}

.scenarios__cols {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.scenarios__col {
  display: grid;
  gap: 18px;
  border-radius: 18px;
  padding: 26px;
}

.scenarios__col hr {
  margin: 0;
  border: 0;
  border-top: 1px solid var(--line);
}

.scenarios__colHead {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 14.5px;
}

.scenarios__colHead i {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid currentColor;
}

.scenarios__colHead .mono {
  margin-left: auto;
  color: var(--ink-3);
  font-size: 11px;
}

.scenarios__col.is-on .scenarios__colHead i,
.scenarios__col.is-on li svg {
  color: var(--d-fin);
}

.scenarios__col.is-off .scenarios__colHead i,
.scenarios__col.is-off li svg {
  color: var(--ink-3);
}

.scenarios__col ul {
  display: grid;
  gap: 15px;
}

.scenarios__col li {
  display: flex;
  align-items: start;
  gap: 11px;
}

.scenarios__col li svg {
  flex: none;
  margin-top: 3px;
}

.scenarios__col li b {
  display: block;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.4;
}

.scenarios__col li em {
  display: block;
  margin-top: 4px;
  color: var(--ink-3);
  font-size: 11px;
  font-style: normal;
  line-height: 1.5;
}

@media (max-width: 1000px) {
  .control__split {
    grid-template-columns: 1fr;
  }

  .scenarios__cols {
    grid-template-columns: 1fr;
  }

  .scenarios__head {
    flex-direction: column;
    align-items: start;
    gap: 16px;
  }
}
</style>
