import { formatNumber } from "./timeTools";
import axios from "axios";
import dayjs from "dayjs";

const REQUEST_TIMEOUT = 20000;
const CACHE_DURATION = 60;

/**
 * 获取监控数据
 * @param {string} apikey - UptimeRobot 的 API 密钥
 * @param {number} days - 获取的天数
 * @param {Object} cache - mobx-cache
 * @param {Object} status - mobx-status
 * @returns {Promise<Array>} - 处理后的监控数据
 */
export const getSiteData = async (apikey, days, cache, status) => {
  const dates = [];
  const today = dayjs(new Date().setHours(0, 0, 0, 0));

  // 生成日期范围数组
  for (let d = 0; d < days; d++) {
    dates.push(today.subtract(d, "day"));
  }

  // 生成自定义历史数据范围
  const ranges = dates.map(
    (date) => `${date.unix()}_${date.add(1, "day").unix()}`
  );
  const start = dates[dates.length - 1].unix();
  const end = dates[0].add(1, "day").unix();
  ranges.push(`${start}_${end}`);

  const processAndUpdate = (monitors) => {
    const processedData = dataProcessing(monitors, dates);
    changeSite(processedData, status);
    return processedData;
  };

  const useCache = (withDelay = false) => {
    if (!cache.siteData?.data?.length) return null;

    const { data, timestamp } = cache.siteData;
    const currentTime = new Date().getTime();
    const isFresh = currentTime - timestamp < CACHE_DURATION * 1000;

    if (!isFresh && withDelay) return null;

    const resolveCache = () => {
      console.log("触发缓存");
      return processAndUpdate(data);
    };

    if (!withDelay) return resolveCache();

    return new Promise((resolve) => {
      const delay = Math.floor(Math.random() * (1200 - 500 + 1)) + 500;
      setTimeout(() => resolve(resolveCache()), delay);
    });
  };

  try {
    // 检查是否有可用缓存数据
    const cachedData = useCache(true);
    if (cachedData) return cachedData;

    // 准备请求数据的参数
    const postdata = {
      api_key: apikey,
      format: "json",
      logs: 1,
      response_times: 1,
      log_types: "1-2",
      logs_start_date: start,
      logs_end_date: end,
      custom_uptime_ranges: ranges.join("-"),
    };

    // 发送获取监控数据的请求
    const response = await getMonitorsData(postdata, status);
    const monitors = Array.isArray(response?.monitors) ? response.monitors : [];

    if (!monitors.length) {
      throw new Error("接口未返回可用的 monitors 数据");
    }

    // 储存数据到缓存
    cache.changeSiteData({
      data: monitors,
      timestamp: new Date().getTime(),
    });

    // 处理监控数据并更新站点状态
    return processAndUpdate(monitors);
  } catch (error) {
    console.error("获取监控数据时出错：", error);
    status.changeSiteState("wrong");

    // 请求超时或接口异常时，尽量使用旧缓存维持页面可用。
    return useCache(false) || [];
  }
};

/**
 * 发送获取监控数据的请求
 * @param {Object} data - 请求数据
 * @returns {Promise<Object>} - 监控数据的响应
 */
const getMonitorsData = async (postdata, status) => {
  try {
    const globalApi = import.meta.env.VITE_GLOBAL_API;
    const response = await axios.post(globalApi, postdata, {
      timeout: REQUEST_TIMEOUT,
    });
    return response.data;
  } catch (error) {
    console.error("获取监控数据时出错：", error);
    status.changeSiteState("wrong");
    throw error;
  }
};

/**
 * 对监控数据进行处理
 * @param {Array} data - 监控数据
 * @param {Array} dates - 日期数组
 * @returns {Array} - 处理后的数据
 */
const dataProcessing = (data, dates) => {
  if (!Array.isArray(data)) return [];

  return data.map((monitor) => {
    const ranges = (monitor.custom_uptime_ranges || "").split("-");
    const average = formatNumber(ranges.pop());
    const daily = [];
    const map = [];

    dates.forEach((date, index) => {
      map[date.format("YYYYMMDD")] = index;
      daily[index] = {
        date: date,
        uptime: formatNumber(ranges[index]),
        down: { times: 0, duration: 0 },
      };
    });

    /**
     * 统计总故障次数和累计故障时长
     * @param {Object} total - 初始总数
     * @param {Object} log - 日志数据
     * @returns {Object} - 更新后的总数
     */
    const calculateTotal = (total, log) => {
      if (log.type === 1) {
        const date = dayjs.unix(log.datetime).format("YYYYMMDD");
        total.duration += log.duration;
        total.times += 1;
        const dailyItem = daily[map[date]];

        if (dailyItem) {
          dailyItem.down.duration += log.duration;
          dailyItem.down.times += 1;
        }
      }
      return total;
    };

    const total = (monitor.logs || []).reduce(calculateTotal, {
      times: 0,
      duration: 0,
    });

    const result = {
      id: monitor.id,
      name: monitor.friendly_name,
      url: monitor.url,
      average: average,
      responseTime: Number(monitor.average_response_time) || 0,
      daily: daily,
      total: total,
      status: "unknown",
    };

    if (monitor.status === 2) result.status = "ok";
    if (monitor.status === 9) result.status = "down";
    return result;
  });
};

/**
 * 更改站点状态
 * @param {Array} data - 站点数据
 * @param {Object} status - mobx-status
 */
const changeSite = (data, status) => {
  try {
    if (!data.length) {
      status.changeSiteState("wrong");
      return;
    }

    const isAllStatusOk = data.every((item) => item.status === "ok");
    const isAnyStatusOk = data.some((item) => item.status === "ok");

    // 更改图标
    const faviconLink = document.querySelector('link[rel="shortcut icon"]');
    if (faviconLink) {
      faviconLink.href = isAllStatusOk
        ? "./favicon.ico"
        : "./favicon-down.ico";
    }

    // 更改状态
    if (isAllStatusOk) {
      status.changeSiteState("normal");
    } else if (isAnyStatusOk) {
      status.changeSiteState("error");
    } else {
      status.changeSiteState("allError");
    }
  } catch (error) {
    console.error("更改站点状态时发生错误：", error);
    status.changeSiteState("error");
  }
};
