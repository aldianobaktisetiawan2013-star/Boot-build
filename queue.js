// queue.js
// Queue FIFO sederhana, proses satu build dalam satu waktu biar GitHub Actions
// runner gak rebutan & gampang di-tracking statusnya.

class BuildQueue {
  constructor() {
    this.jobs = [];
    this.processing = false;
    this.handler = null; // async function(job)
  }

  setHandler(fn) {
    this.handler = fn;
  }

  add(job) {
    this.jobs.push(job);
    const position = this.jobs.length;
    this._processNext();
    return position; // posisi di antrian saat ditambahkan
  }

  size() {
    return this.jobs.length + (this.processing ? 1 : 0);
  }

  async _processNext() {
    if (this.processing) return;
    const job = this.jobs.shift();
    if (!job) return;

    this.processing = true;
    try {
      await this.handler(job);
    } catch (e) {
      console.error("Queue job error:", e);
      if (job.onError) job.onError(e);
    } finally {
      this.processing = false;
      this._processNext();
    }
  }
}

module.exports = new BuildQueue();
