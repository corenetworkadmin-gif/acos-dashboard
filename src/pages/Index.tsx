import { Header } from '@/components/Header';
import { Widget } from '@/components/Widget';
import OperationLog from '@/components/OperationLog';
import CapabilityRegistry from '@/components/CapabilityRegistry';
import ResourceMonitor from '@/components/ResourceMonitor';
import CompanionChat from '@/components/CompanionChat';
import LocalAIEngineStatus from '@/components/LocalAIEngineStatus';
import AdminInterlockStatus from '@/components/AdminInterlockStatus';
import CompanionImport from '@/components/CompanionImport';

export default function Index() {
  return (
    <div className="min-h-screen bg-black bg-op-90 text-white antialiased">
      {/* Animated background simulation */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-950/80 to-black/90 animate-pulse" />
      </div>
      
      <Header />
      
      <main className="pt-16 pb-8 px-6">
        <div className="max-w-7xl mx-auto">
          {/* Welcome section */}
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-bold text-cyan-400 mb-4">
              ACOS Dashboard
            </h2>
            <p className="text-cyan-300 max-w-xl mx-auto">
              AI Companion Operating System - Full System with Companion Import
            </p>
          </div>
          
          {/* Grid layout for widgets - 2 columns on large screens, 1 on small */}
          <div className="grid gap-6">
            {/* Row 1: Operation Log and Capability Registry */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Widget title="Operation Log">
                <OperationLog />
              </Widget>
              <Widget title="Capability Registry">
                <CapabilityRegistry />
              </Widget>
            </div>
            
            {/* Row 2: Resource Monitor and Local AI Engine Status */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Widget title="Resource Monitor">
                <ResourceMonitor />
              </Widget>
              <Widget title="Local AI Engine Status">
                <LocalAIEngineStatus />
              </Widget>
            </div>
            
            {/* Row 3: Companion Chat and Admin Interlock Status */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Widget title="Companion Chat">
                <CompanionChat />
              </Widget>
              <Widget title="Administrator Interlock">
                <AdminInterlockStatus />
              </Widget>
            </div>
            
            {/* Row 4: Companion Import (full width) */}
            <div className="col-span-2">
              <Widget title="Companion Import / Relocation">
                <CompanionImport />
              </Widget>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}