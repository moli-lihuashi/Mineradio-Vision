#!/bin/sh
cd /d/Mineradio/Mineradio-Kugou-Modified-main || exit 1
# 批跑假红的两种形态（都不改判据，只避免把「驱动层故障」当成回归）：
#   1) 纯等待/抢窗口：单跑必过。每条之间 sleep 3，并把每条的原始日志另存留档。
#   2) 传输层故障：末尾 `SMOKE ERROR cdp timeout Runtime.evaluate` 或
#      `Cannot find default execution context`。此时 **整轮断言结果不可信** ——
#      eval 会乱序/重试，导致读到旧 DOM 或后续写入（曾见 image-pool 一轮 10 条 FAIL，
#      单跑 33/33 全过）。所以：只有传输层故障才自动重试一次（最多 2 次），
#      并且**只有出现 FAIL 断言行、且没有传输层故障**才算真红。
mkdir -p .workbuddy/tmp/exe-logs
RETRY=0
for f in smoke-folia-background.js smoke-folia-cadenza.js smoke-folia-cappella.js \
         smoke-folia-claddagh.js smoke-folia-classic.js smoke-folia-diorama.js \
         smoke-folia-fume.js smoke-folia-glass-mirror.js smoke-folia-image-pool.js \
         smoke-folia-lumiere.js smoke-folia-monet.js smoke-folia-panel-layout.js \
         smoke-folia-partita.js smoke-folia-pendolo.js smoke-folia-sonnet.js \
         smoke-folia-tempera.js smoke-folia-tilt.js smoke-folia-world.js; do
  log=".workbuddy/tmp/exe-logs/${f%.js}.txt"
  printf '== %s ' "$f"
  attempt=1
  while : ; do
    timeout 300 /d/nodejs/node.exe .workbuddy/harness/run-exe-smoke.js "$f" --no-sync > "$log" 2>&1
    verdict=$(grep -E "ALL PASS|FAILED|SMOKE ERROR|TIMEOUT" "$log" | tail -1)
    if printf '%s' "$verdict" | grep -q "ALL PASS"; then break; fi

    # 判定「这一轮的失败是否可信」。驱动层故障下整轮结果作废，重试一次。
    transport=0
    grep -qE "cdp timeout|Cannot find default execution context" "$log" && transport=1
    if printf '%s' "$verdict" | grep -q "TIMEOUT"; then
      # 超时但一条断言都没跑出来 = attach 阶段就没拿到执行上下文，不是应用卡死
      grep -qE "^PASS |^FAIL " "$log" || transport=1
    fi
    [ -z "$verdict" ] && transport=1
    if [ "$transport" = 1 ] && [ "$attempt" = 1 ]; then
      printf '[transport-retry: %s] ' "${verdict:-无判定行}"
      attempt=2
      RETRY=$((RETRY + 1))
      sleep 5
      continue
    fi
    break
  done
  printf '%s\n' "${verdict:-无判定行（重试后仍无）}"
  sleep 3
done
echo "== transport-retry 次数: $RETRY"
