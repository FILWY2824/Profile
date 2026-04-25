// runtime.go — 进程级 Go runtime 调优 + 内存观测。
//
// 目标:把驻留内存(RSS)长期压在 50 MiB 以下,容器 limit 100 MiB 还有 2x
// 余量。在 idle 时主动把页面归还内核(MADV_DONTNEED),关 stop-the-world 后
// htop / docker stats 的数字立即下降。
//
// 真正吃内存的地方依次是(2024 量级、idle 状态):
//
//   1. modernc.org/sqlite 页缓存与 mmap        ~3-8 MiB(已在 db.go 收紧到 ~2 MiB)
//   2. Go runtime 堆 + scavenger 元数据         ~8-15 MiB
//   3. embed.FS 里的 SPA 静态文件(read-only,与 binary 共享映射,不计 RSS)
//   4. Echo 路由表 + 中间件链                   ~1-2 MiB
//   5. JWT signer / settings 缓存 / repo 句柄  ~1-2 MiB
//   6. ratelimit 内存桶(2000 上限,典型 idle <50)~< 500 KiB
//   7. HTTP 连接 buffer,每条 ~16 KiB           ~取决于并发
//
// 注意 *前端 Vue 组件不进堆*。它们被 Vite 编译成 .js/.css,Go 用 go:embed
// 把字节流嵌进二进制只读段。HTTP 请求时 net/http 的 FileServer 通过
// http.ServeContent 直接 io.Copy,不经过应用堆。所以 "前端组件多了"对
// 服务端 RSS 几乎没有影响 ─ 顶多增加几百 KiB 的 embed 段。
//
// 用 LOG_MEMSTATS_SEC=300 (默认) 打开 5 分钟一次的 memstats 行,你能在
// `docker logs qishu` 里直接看 HeapAlloc / Sys / RSS 走势,不用猜。
package main

import (
	"log"
	"os"
	"runtime"
	"runtime/debug"
	"strconv"
	"time"
)

const (
	memLimitBytes int64 = 48 * 1024 * 1024 // 48 MiB ─ 给容器 limit 100 MiB 留 2x 余量
	gcPercent           = 20               // 比默认 100 激进 5x
	goMaxProcs          = 2                // 限 P/M 数量,降低 thread 计数
	scavengeEvery       = 30 * time.Second // 周期性把 free 页归还内核
)

// applyRuntimeTuning 在 main() 第一时间调用。返回一个 stop chan,关闭它会
// 停止两条后台 goroutine(scavenger + memstats logger)。
func applyRuntimeTuning() (stop chan struct{}) {
	// 1) 关掉 runtime 自带的内存采样(~每 512 KiB 分配采一次)。这套采样是
	//    给 pprof 用的,我们用不到,关掉省 CPU 也省一点 RSS。
	runtime.MemProfileRate = 0

	// 2) 内存上限。Go 1.19+ 才有,modernc.org/sqlite + Echo 都满足。
	debug.SetMemoryLimit(memLimitBytes)

	// 3) 更激进的 GC。
	debug.SetGCPercent(gcPercent)

	// 4) 锁线程数。注意:这是建议值,blocking syscall 仍可能临时多开 M,
	//    但稳定态会回到这个数。
	runtime.GOMAXPROCS(goMaxProcs)

	// 5) 限制 mutex 分析器不分配额外 buffer。
	runtime.SetMutexProfileFraction(0)
	runtime.SetBlockProfileRate(0)

	log.Printf("[runtime] mem_limit=%dMiB gc_percent=%d gomaxprocs=%d scavenge=%s",
		memLimitBytes>>20, gcPercent, goMaxProcs, scavengeEvery)

	stop = make(chan struct{})

	// 6) Scavenger:周期性强制把 free 页归还内核(MADV_DONTNEED)。
	go func() {
		t := time.NewTicker(scavengeEvery)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				debug.FreeOSMemory()
			case <-stop:
				return
			}
		}
	}()

	// 7) Memstats 周期日志。让你能 `docker logs qishu | grep memstats` 直接
	//    看堆走势,不必信 htop(htop 把 thread 拆成多行有误导)。
	if interval := readEnvInt("LOG_MEMSTATS_SEC", 300); interval > 0 {
		go memstatsLogger(time.Duration(interval)*time.Second, stop)
	}

	return stop
}

func memstatsLogger(every time.Duration, stop <-chan struct{}) {
	t := time.NewTicker(every)
	defer t.Stop()
	var m runtime.MemStats
	for {
		select {
		case <-t.C:
			runtime.ReadMemStats(&m)
			log.Printf("[memstats] heap_alloc=%dKiB heap_sys=%dKiB heap_idle=%dKiB heap_released=%dKiB sys=%dKiB stack_inuse=%dKiB num_gc=%d goroutines=%d threads=%d",
				m.HeapAlloc>>10,
				m.HeapSys>>10,
				m.HeapIdle>>10,
				m.HeapReleased>>10,
				m.Sys>>10,
				m.StackInuse>>10,
				m.NumGC,
				runtime.NumGoroutine(),
				numThreadsBest(),
			)
		case <-stop:
			return
		}
	}
}

// numThreadsBest 返回当前 OS 线程估算值,失败返回 -1。
func numThreadsBest() int {
	// runtime 没暴露 thread count;我们读 /proc/self/status 拿 Threads:
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return -1
	}
	const key = "Threads:"
	s := string(b)
	for i := 0; i+len(key) < len(s); i++ {
		if s[i:i+len(key)] == key {
			j := i + len(key)
			for j < len(s) && (s[j] == ' ' || s[j] == '\t') {
				j++
			}
			k := j
			for k < len(s) && s[k] >= '0' && s[k] <= '9' {
				k++
			}
			if k > j {
				if n, err := strconv.Atoi(s[j:k]); err == nil {
					return n
				}
			}
			return -1
		}
	}
	return -1
}

func readEnvInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
