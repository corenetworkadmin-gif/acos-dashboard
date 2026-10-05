// Synthetic validation fixture, never used by the ACOS runtime.
#define _GNU_SOURCE
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/resource.h>
#include <unistd.h>

static pthread_barrier_t ready;
static double deadline;
static int cpu_only;
static double now(void) {
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec + t.tv_nsec / 1e9;
}
static void *worker(void *unused) {
  (void)unused;
  void *blocks[128] = {0};
  if (!cpu_only) for (int i=0;i<128;i++) {
    blocks[i]=malloc(65536); if (!blocks[i]) _Exit(22);
    memset(blocks[i], i, 65536);
  }
  pthread_barrier_wait(&ready);
  volatile unsigned long work = 1;
  while (now() < deadline) {
    if (cpu_only) for (int j=0;j<10000;j++) work = work * 1664525 + 1013904223;
    else usleep(1000);
  }
  for (int i=0;i<128;i++) free(blocks[i]);
  return NULL;
}
int main(int argc, char **argv) {
  int count=1; double seconds=.1;
  for (int i=1;i+1<argc;i++) if (!strcmp(argv[i],"-t")) count=atoi(argv[i+1]);
  if (argc==4 && !strcmp(argv[1],"--cpu-probe")) {cpu_only=1;count=atoi(argv[2]);seconds=atof(argv[3]);}
  if (count<1 || count>64) return 20;
  pthread_t workers[64];
  if (pthread_barrier_init(&ready,NULL,count+1)) return 21;
  deadline=now()+seconds;
  for (int i=0;i<count;i++) {
    int error=pthread_create(&workers[i],NULL,worker,NULL);
    if(error){fprintf(stderr,"pthread_create worker %d: %s\n",i,strerror(error));return 23;}
  }
  pthread_barrier_wait(&ready);
  for(int i=0;i<count;i++) pthread_join(workers[i],NULL);
  struct rlimit as,cpu,stack,nproc; struct rusage usage;
  getrlimit(RLIMIT_AS,&as);getrlimit(RLIMIT_CPU,&cpu);getrlimit(RLIMIT_STACK,&stack);getrlimit(RLIMIT_NPROC,&nproc);getrusage(RUSAGE_SELF,&usage);
  printf("{\"threads\":%d,\"addressSpaceBytes\":%llu,\"cpuSeconds\":%llu,\"stackBytes\":%llu,\"nproc\":%llu,\"arenaMax\":\"%s\",\"peakRssKiB\":%ld}\n",count,(unsigned long long)as.rlim_cur,(unsigned long long)cpu.rlim_cur,(unsigned long long)stack.rlim_cur,(unsigned long long)nproc.rlim_cur,getenv("MALLOC_ARENA_MAX")?getenv("MALLOC_ARENA_MAX"):"unset",usage.ru_maxrss);
  return 0;
}
