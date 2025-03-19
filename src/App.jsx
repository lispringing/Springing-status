import { useState, useEffect } from "react";
import { observer } from "mobx-react-lite";
import { getSiteData } from "@/utils/getSiteData";
import { GlobalScrollbar } from "mac-scrollbar";
import useStores from "@/hooks/useStores";
import Header from "@/components/header";
import SiteStatus from "@/components/siteStatus";
import Footer from "@/components/footer";

const App = observer(() => {
  const { cache, status } = useStores();
  const [siteData, setSiteData] = useState(null);

  // 加载配置
  const siteName = import.meta.env.VITE_SITE_NAME;
  const apiKey = import.meta.env.VITE_API_KEY;
  const countDays = import.meta.env.VITE_COUNT_DAYS;

  useEffect(() => {
    // 更改站点标题
    document.title = siteName;
    // 获取站点数据
    getSiteData(apiKey, countDays, cache, status).then((res) => {
      console.log(res);
      setSiteData(res);
    });
  }, [apiKey, countDays]);

  return (
    <>
      <GlobalScrollbar />
      <Header />
      <main id="main">
        <div className="container">
          <div className="all-site">
            <SiteStatus siteData={siteData} days={countDays} status={status} />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
});

export default App;
