package run.halo.plugin.textdiagram;

public class JSInjector {
    static String getParsedKatexScript(String darkClassSelector, String mermaid_selector) {
        String katexScript = """
            <script defer src="/plugins/text-diagram/assets/static/mermaid.min.js"></script>
            <script>
                document.addEventListener("DOMContentLoaded", function() {
                  const postBody = document.body
                  let darkModel = document.querySelector('%s')
                  document.documentElement.classList.toggle('td-lb-dark', !!darkModel)
                  mermaid.initialize({
                    startOnLoad: false,
                    theme: darkModel?'dark':'default'
                  });
                  mermaid.run({
                    querySelector: '%s',
                  });
                });
            </script>
            """;
        return String.format(katexScript, darkClassSelector, mermaid_selector);
    }

    /**
     * 点击放大预览（lightbox）的静态资源引用，跟随插件开关注入。
     */
    static String getLightboxAssets(boolean enabled) {
        if (!enabled) {
            return "";
        }
        return """
            <link rel="stylesheet" href="/plugins/text-diagram/assets/static/lightbox.css">
            <script defer src="/plugins/text-diagram/assets/static/lightbox.js"></script>
            """;
    }
}