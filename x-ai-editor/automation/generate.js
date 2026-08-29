const { runPipeline } = require('./pipeline');

runPipeline({ onProgress: (msg) => console.log(msg) }).then((result) => {
  if (['read_failed', 'router_failed', 'editor_failed'].includes(result.status)) {
    console.error(result.message);
    process.exitCode = 1;
  } else if (result.status === 'success') {
    console.log(`専門GPT成功: ${result.success.join(', ')}`);
    if (result.failed.length > 0) {
      console.log(`専門GPT失敗: ${result.failed.join(', ')}`);
    }
  }
});
