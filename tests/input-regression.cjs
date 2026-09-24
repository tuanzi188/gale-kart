'use strict';

// 使用实际游戏脚本运行输入回归，模拟事件捕获和多指释放。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const sourcePath = process.argv[2] || path.join(__dirname, '..', 'index.html');
const gameSource = fs.readFileSync(sourcePath, 'utf8');
const scriptMatch = gameSource.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, '必须找到游戏脚本');
const bootMarker = 'var of=typeof window<"u"?window.claude?.hot:null;of?.ready?of.ready(rf):rf();';
assert.ok(scriptMatch[1].includes(bootMarker), '必须找到启动入口');
const exportedScript = scriptMatch[1].replace(bootMarker, 'globalThis.regressionModules={Ko,jo,md,gr};');
new vm.Script(scriptMatch[1], { filename: sourcePath });
const completedCases = [];
const failedCases = [];

function makeEventSurface() {
  const surfaceListeners = new Map();
  return {
    addEventListener(surfaceType, surfaceCallback) {
      if (!surfaceListeners.has(surfaceType)) surfaceListeners.set(surfaceType, []);
      surfaceListeners.get(surfaceType).push(surfaceCallback);
    },
    removeEventListener() {},
    emitSurface(surfaceKind, surfaceEvent) {
      for (const surfaceHandler of surfaceListeners.get(surfaceKind) || []) surfaceHandler(surfaceEvent);
    }
  };
}

function makeControl(controlAction, pageWindow) {
  const controlSurface = makeEventSurface();
  const controlClasses = new Set();
  const controlCaptures = new Set();
  return Object.assign(controlSurface, {
    tagName: 'BUTTON', dataset: { touch: controlAction }, disabled: false, captureFails: false,
    classes: controlClasses, captures: controlCaptures,
    classList: {
      add(classAdded) { controlClasses.add(classAdded); },
      remove(classRemoved) { controlClasses.delete(classRemoved); },
      toggle(classToggled, isPresent) { isPresent ? controlClasses.add(classToggled) : controlClasses.delete(classToggled); }
    },
    setPointerCapture(captureKey) {
      if (this.captureFails) throw new Error('模拟浏览器拒绝捕获');
      controlCaptures.add(captureKey);
    },
    hasPointerCapture(captureQuery) { return controlCaptures.has(captureQuery); },
    releasePointerCapture(captureReleased) {
      controlCaptures.delete(captureReleased);
      this.emitSurface('lostpointercapture', { pointerId: captureReleased, preventDefault() {} });
    },
    sendPointer(pointerKind, pointerNumber, pointerX = 0, pointerY = 0) {
      const dispatchedPointer = {
        pointerId: pointerNumber, pointerType: 'touch', button: 0,
        clientX: pointerX, clientY: pointerY, target: this, preventDefault() {}
      };
      pageWindow.emitSurface(pointerKind, dispatchedPointer);
      this.emitSurface(pointerKind, dispatchedPointer);
      if (['pointerup', 'pointercancel', 'lostpointercapture'].includes(pointerKind)) controlCaptures.delete(pointerNumber);
    }
  });
}

function createInputFixture() {
  const fixtureWindow = Object.assign(makeEventSurface(), {
    innerWidth: 844, innerHeight: 390,
    matchMedia: () => ({ matches: true }),
    localStorage: { getItem: () => null, setItem() {} }
  });
  const fixtureContext = {
    window: fixtureWindow, navigator: { getGamepads: () => [] },
    console: { log() {}, warn() {}, error() {} }, performance: { now: () => 0 },
    setTimeout, clearTimeout
  };
  vm.runInNewContext(exportedScript, fixtureContext);
  const fixtureButtons = ['left', 'right', 'brake', 'drift', 'use', 'swap', 'respawn'].map(fixtureAction => makeControl(fixtureAction, fixtureWindow));
  const fixtureFind = fixtureName => fixtureButtons.find(fixtureButton => fixtureButton.dataset.touch === fixtureName);
  const fixtureSteering = makeControl('pad', fixtureWindow);
  fixtureSteering.querySelector = steeringSelector => fixtureButtons.find(steeringButton => steeringSelector.includes('"' + steeringButton.dataset.touch + '"'));
  fixtureSteering.getBoundingClientRect = () => ({ left: 20, right: 168, top: 250, bottom: 320 });
  const fixtureInput = new fixtureContext.regressionModules.Ko();
  fixtureInput.bindTouch({ querySelectorAll: () => fixtureButtons, querySelector: () => fixtureSteering });
  fixtureInput.gameActive = true;
  return {
    input: fixtureInput, win: fixtureWindow, button: fixtureFind, steer: fixtureSteering,
    modules: fixtureContext.regressionModules,
    key(keyKind, keyCode, keyRepeat = false, keyTarget = { tagName: 'BODY' }) {
      const fixtureKeyEvent = { code: keyCode, repeat: keyRepeat, target: keyTarget, prevented: false, preventDefault() { this.prevented = true; } };
      fixtureWindow.emitSurface(keyKind, fixtureKeyEvent);
      return fixtureKeyEvent;
    }
  };
}

function runInputCase(caseLabel, caseCheck) {
  try { caseCheck(createInputFixture()); completedCases.push(caseLabel); }
  catch (caseFailure) { failedCases.push({ case: caseLabel, message: caseFailure.message }); }
}

runInputCase('键盘油门、左转、漂移、道具同时响应', setup => {
  ['ArrowUp', 'ArrowLeft', 'ShiftLeft', 'Space'].forEach(code => setup.key('keydown', code));
  const frame = setup.input.poll();
  assert.equal(frame.throttle, 1); assert.equal(frame.steer, -1); assert.equal(frame.drift, true); assert.equal(frame.usePressed, true);
});
runInputCase('键盘反打时后按方向优先，松开恢复前方向', setup => {
  setup.key('keydown', 'ArrowLeft'); setup.key('keydown', 'ArrowRight');
  assert.equal(setup.input.poll().steer, 1);
  setup.key('keyup', 'ArrowRight'); assert.equal(setup.input.poll().steer, -1);
});
runInputCase('旧方向自动重复不抢走新方向', setup => {
  setup.key('keydown', 'KeyA'); setup.key('keydown', 'KeyD'); setup.key('keydown', 'KeyA', true);
  assert.equal(setup.input.poll().steer, 1);
});
runInputCase('同一动作的两枚物理按键不会互相释放', setup => {
  setup.key('keydown', 'ArrowUp'); setup.key('keydown', 'KeyW'); setup.key('keyup', 'ArrowUp');
  assert.equal(setup.input.poll().throttle, 1);
  setup.key('keyup', 'KeyW'); assert.equal(setup.input.poll().throttle, 0);
});
runInputCase('松开漂移不影响油门和方向', setup => {
  ['KeyW', 'KeyA', 'KeyJ'].forEach(code => setup.key('keydown', code)); setup.key('keyup', 'KeyJ');
  const released = setup.input.poll(); assert.equal(released.throttle, 1); assert.equal(released.steer, -1); assert.equal(released.drift, false);
});
runInputCase('设置输入框不遗留驾驶动作', setup => {
  setup.input.gameActive = false; setup.key('keydown', 'ArrowUp', false, { tagName: 'INPUT' }); setup.input.gameActive = true;
  assert.equal(setup.input.poll().throttle, 0);
});
runInputCase('触屏左转、漂移、道具三指同时响应', setup => {
  setup.input.autoThrottle = true; setup.steer.sendPointer('pointerdown', 1, 50, 280);
  setup.button('drift').sendPointer('pointerdown', 2); setup.button('use').sendPointer('pointerdown', 3);
  const touchFrame = setup.input.poll(); assert.equal(touchFrame.steer, -1); assert.equal(touchFrame.drift, true); assert.equal(touchFrame.usePressed, true); assert.equal(touchFrame.throttle, 1);
});
runInputCase('方向滑动不释放右手漂移', setup => {
  setup.steer.sendPointer('pointerdown', 4, 50, 280); setup.button('drift').sendPointer('pointerdown', 5);
  setup.steer.sendPointer('pointermove', 4, 140, 280);
  assert.equal(setup.input.poll().steer, 1); assert.equal(setup.input.poll().drift, true);
});
runInputCase('触屏两方向交接优先使用新方向', setup => {
  setup.steer.sendPointer('pointerdown', 6, 50, 280); setup.steer.sendPointer('pointerdown', 7, 140, 280);
  assert.equal(setup.input.poll().steer, 1); setup.steer.sendPointer('pointerup', 7, 140, 280); assert.equal(setup.input.poll().steer, -1);
});
runInputCase('普通窗口尺寸变化不中断按住转向', setup => {
  setup.steer.sendPointer('pointerdown', 8, 50, 280); setup.win.innerHeight = 360; setup.win.emitSurface('resize', {});
  assert.equal(setup.input.poll().steer, -1); setup.steer.sendPointer('pointermove', 8, 140, 280); assert.equal(setup.input.poll().steer, 1);
});
runInputCase('真正横竖屏切换清理两只手的输入', setup => {
  setup.steer.sendPointer('pointerdown', 9, 50, 280); setup.button('drift').sendPointer('pointerdown', 10);
  setup.win.innerWidth = 390; setup.win.innerHeight = 844; setup.win.emitSurface('resize', {});
  const rotated = setup.input.poll(); assert.equal(rotated.steer, 0); assert.equal(rotated.drift, false);
});
runInputCase('动作按钮捕获失败仍响应并能在窗口外松开', setup => {
  setup.button('drift').captureFails = true; setup.button('drift').sendPointer('pointerdown', 11);
  assert.equal(setup.input.poll().drift, true);
  setup.win.emitSurface('pointerup', { pointerId: 11, preventDefault() {} }); assert.equal(setup.input.poll().drift, false);
});
runInputCase('方向捕获失败后仍能滑动和释放', setup => {
  setup.steer.captureFails = true; setup.steer.sendPointer('pointerdown', 12, 50, 280);
  assert.equal(setup.input.poll().steer, -1); setup.steer.sendPointer('pointermove', 12, 140, 280); assert.equal(setup.input.poll().steer, 1);
  setup.win.emitSurface('pointerup', { pointerId: 12, preventDefault() {} }); assert.equal(setup.input.poll().steer, 0);
});
runInputCase('同一动作两指按住时只释放对应手指', setup => {
  setup.button('drift').sendPointer('pointerdown', 13); setup.button('drift').sendPointer('pointerdown', 14);
  setup.button('drift').sendPointer('pointerup', 13); assert.equal(setup.input.poll().drift, true);
  setup.button('drift').sendPointer('pointerup', 14); assert.equal(setup.input.poll().drift, false);
});
runInputCase('按钮变为禁用后窗口松手仍清理输入', setup => {
  setup.button('swap').sendPointer('pointerdown', 15); setup.button('swap').disabled = true;
  setup.win.emitSurface('pointerup', { pointerId: 15, preventDefault() {} }); assert.equal(setup.input.touch.swap, false);
});
runInputCase('取消触点不会清掉另一只手', setup => {
  setup.steer.sendPointer('pointerdown', 16, 50, 280); setup.button('drift').sendPointer('pointerdown', 17);
  setup.button('drift').sendPointer('pointercancel', 17); assert.equal(setup.input.poll().steer, -1); assert.equal(setup.input.poll().drift, false);
});
runInputCase('切后台清空按下状态和一次性操作', setup => {
  setup.key('keydown', 'Space'); setup.key('keydown', 'KeyW'); setup.steer.sendPointer('pointerdown', 18, 50, 280);
  setup.win.emitSurface('blur', {}); const cleared = setup.input.poll(); assert.equal(cleared.throttle, 0); assert.equal(cleared.steer, 0); assert.equal(cleared.usePressed, false);
});
runInputCase('暂停触屏状态不接受新的操作', setup => {
  setup.input.gameActive = false; setup.steer.sendPointer('pointerdown', 19, 50, 280); setup.button('drift').sendPointer('pointerdown', 20);
  assert.equal(setup.input.poll().steer, 0); assert.equal(setup.input.poll().drift, false);
});
runInputCase('刹车仍覆盖触屏自动油门', setup => {
  setup.input.autoThrottle = true; setup.button('brake').sendPointer('pointerdown', 21);
  assert.equal(setup.input.poll().throttle, 0); assert.equal(setup.input.poll().brake, 1);
});
runInputCase('滑出方向区回中，滑回恢复', setup => {
  setup.steer.sendPointer('pointerdown', 22, 50, 280); setup.steer.sendPointer('pointermove', 22, 220, 280);
  assert.equal(setup.input.poll().steer, 0); setup.steer.sendPointer('pointermove', 22, 140, 280); assert.equal(setup.input.poll().steer, 1);
});
runInputCase('触屏与键盘同时存在时最新方向优先', setup => {
  setup.key('keydown', 'ArrowLeft'); setup.steer.sendPointer('pointerdown', 23, 140, 280);
  assert.equal(setup.input.poll().steer, 1); setup.steer.sendPointer('pointerup', 23, 140, 280); assert.equal(setup.input.poll().steer, -1);
});
runInputCase('单次使用道具只产生一帧触发信号', setup => {
  setup.button('use').sendPointer('pointerdown', 24); assert.equal(setup.input.poll().usePressed, true); assert.equal(setup.input.poll().usePressed, false);
});
runInputCase('真实比赛接受转向加漂移加氮气组合', setup => {
  const racingTrack = setup.modules.md(setup.modules.gr('village'));
  const raceModel = new setup.modules.jo({ track: racingTrack, mode: 'speed', laps: 1, player: {}, aiCount: 0, skipIntro: true, autoInstant: true });
  raceModel.phase = 'racing'; raceModel.time = 2; raceModel.player.nitros = 1;
  raceModel.player.vx = Math.sin(raceModel.player.heading) * 25; raceModel.player.vz = Math.cos(raceModel.player.heading) * 25;
  ['KeyW', 'KeyA', 'KeyJ', 'Space'].forEach(code => setup.key('keydown', code));
  raceModel.update(1 / 60, setup.input.poll());
  assert.ok(raceModel.events.some(event => event.type === 'driftStart'));
  assert.ok(raceModel.events.some(event => event.type === 'nitro'));
});

console.log(JSON.stringify({ 通过: completedCases.length, 失败: failedCases.length, 失败项目: failedCases, 检查项目: completedCases }, null, 2));
if (failedCases.length) process.exitCode = 1;
