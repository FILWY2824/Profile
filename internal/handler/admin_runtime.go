// admin_runtime.go — 暴露进程级 runtime 指标供管理后台/运维 curl。
//
// 端点 GET /api/admin/runtime 返回当前的 MemStats 摘要 + goroutine / OS 线程
// 数 + cgroup 内存(若可读)。这是用户验证"RSS 是否真的 < 100 MiB"的最直接
// 手段 ─ htop 把 Go thread 拆成多行有歧义,docker stats 又要在宿主侧执行,
// 这个端点直接从进程内部读取,数字最靠谱。
//
// 安全:挂在 /api/admin 之下,需要 admin 角色 token,内中不含敏感信息但仍走
// MustAdmin 中间件免得被探测。
package handler

import (
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
)

type AdminRuntimeHandler struct{}

func (h *AdminRuntimeHandler) Register(g *echo.Group) {
	g.GET("", h.snapshot)
}

func (h *AdminRuntimeHandler) snapshot(c echo.Context) error {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	// cgroup v2 / v1 内存读数(容器场景)。失败返回 -1,前端自行处理。
	cgRSS := readCgroupMemoryCurrent()
	cgLimit := readCgroupMemoryMax()

	return c.JSON(http.StatusOK, map[string]any{
		// 堆指标(单位 KiB,前端按需展示)
		"heapAllocKiB":    m.HeapAlloc >> 10,
		"heapSysKiB":      m.HeapSys >> 10,
		"heapIdleKiB":     m.HeapIdle >> 10,
		"heapInuseKiB":    m.HeapInuse >> 10,
		"heapReleasedKiB": m.HeapReleased >> 10,
		"heapObjects":     m.HeapObjects,
		// 整体 ─ Sys 是 Go runtime 向 OS 要的总和,与 RSS 强相关
		"sysKiB":        m.Sys >> 10,
		"stackInuseKiB": m.StackInuse >> 10,
		"stackSysKiB":   m.StackSys >> 10,
		// GC
		"numGC":           m.NumGC,
		"numForcedGC":     m.NumForcedGC,
		"gcCpuFraction":   m.GCCPUFraction,
		"lastGCUnixNano":  m.LastGC,
		"pauseTotalNs":    m.PauseTotalNs,
		// 进程
		"goroutines": runtime.NumGoroutine(),
		"gomaxprocs": runtime.GOMAXPROCS(0),
		"threads":    procThreads(),
		// cgroup(容器内的真实 RSS / limit, 单位 bytes)
		"cgroupMemoryCurrentBytes": cgRSS,
		"cgroupMemoryMaxBytes":     cgLimit,
	})
}

// procThreads 读 /proc/self/status Threads 字段。
func procThreads() int {
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return -1
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "Threads:") {
			v := strings.TrimSpace(strings.TrimPrefix(line, "Threads:"))
			if n, err := strconv.Atoi(v); err == nil {
				return n
			}
			return -1
		}
	}
	return -1
}

// readCgroupMemoryCurrent 容器内拿 cgroup 当前内存占用(bytes)。
//
// cgroup v2: /sys/fs/cgroup/memory.current
// cgroup v1: /sys/fs/cgroup/memory/memory.usage_in_bytes
//
// 返回 -1 表示读不到(裸跑、权限不够、cgroup 路径异常)。
func readCgroupMemoryCurrent() int64 {
	if v, ok := readInt64File("/sys/fs/cgroup/memory.current"); ok {
		return v
	}
	if v, ok := readInt64File("/sys/fs/cgroup/memory/memory.usage_in_bytes"); ok {
		return v
	}
	return -1
}

func readCgroupMemoryMax() int64 {
	// v2: memory.max 可能写 "max"(无限制)
	if b, err := os.ReadFile("/sys/fs/cgroup/memory.max"); err == nil {
		s := strings.TrimSpace(string(b))
		if s == "max" {
			return -1
		}
		if v, err := strconv.ParseInt(s, 10, 64); err == nil {
			return v
		}
	}
	// v1
	if v, ok := readInt64File("/sys/fs/cgroup/memory/memory.limit_in_bytes"); ok {
		// 约定俗成:超大值表示无限制
		if v > (1 << 60) {
			return -1
		}
		return v
	}
	return -1
}

func readInt64File(path string) (int64, bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	v, err := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}
