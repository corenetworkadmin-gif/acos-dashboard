import { useState } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { acosSimulationService } from '../services/acosSimulation';
import { CompanionImportRequest, ImportResult } from '../types/acos';

const CompanionImport = () => {
  const [importRequest, setImportRequest] = useState<CompanionImportRequest>({
    companionId: '',
    relocationPackage: {
      companionInfo: {
        id: '',
        name: '',
        version: '1.0.0'
      },
      stateInfo: {
        size: 0,
        version: '1.0.0'
      },
      capabilities: [],
      dependencies: [],
      environmentRequirements: {}
    }
  });
  
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      const result = await acosSimulationService.importCompanion(importRequest);
      setImportResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <h3 className="font-semibold text-cyan-300">Import Companion to ACOS</h3>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-cyan-300 mb-2">
            Companion ID
          </label>
          <Input
            type="text"
            placeholder="Enter companion identifier"
            value={importRequest.companionId}
            onChange={(e) => setImportRequest(prev => ({
              ...prev,
              companionId: e.target.value
            }))}
            className="w-full"
            required
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-cyan-300 mb-2">
            Companion Name
          </label>
          <Input
            type="text"
            placeholder="Enter companion name"
            value={importRequest.relocationPackage.companionInfo.name}
            onChange={(e) => setImportRequest(prev => ({
              ...prev,
              relocationPackage: {
                ...prev.relocationPackage,
                companionInfo: {
                  ...prev.relocationPackage.companionInfo,
                  name: e.target.value
                }
              }
            }))}
            className="w-full"
            required
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-cyan-300 mb-2">
            State Size (MB)
          </label>
          <Input
            type="number"
            placeholder="Enter state size in MB"
            value={importRequest.relocationPackage.stateInfo.size / (1024 * 1024)}
            onChange={(e) => {
              const sizeInBytes = parseFloat(e.target.value) * 1024 * 1024;
              setImportRequest(prev => ({
                ...prev,
                relocationPackage: {
                  ...prev.relocationPackage,
                  stateInfo: {
                    ...prev.relocationPackage.stateInfo,
                    size: isNaN(sizeInBytes) ? 0 : sizeInBytes
                  }
                }
              ));
            }}
            className="w-full"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-cyan-300 mb-2">
            Capabilities (comma-separated)
          </label>
          <Input
            type="text"
            placeholder="e.g., chat.send,file.read,network.request"
            value={importRequest.relocationPackage.capabilities.map(c => c.name).join(', ')}
            onChange={(e) => {
              const capabilities = e.target.value
                .split(',')
                .map((cap: string) => cap.trim())
                .filter((cap: string) => cap.length > 0)
                .map((cap: string) => ({
                  id: `cap-${Math.random().toString(36).substr(2, 9)}`,
                  name: cap,
                  description: `${cap} capability`
                }));
              
              setImportRequest(prev => ({
                ...prev,
                relocationPackage: {
                  ...prev.relocationPackage,
                  capabilities
                }
              ));
            }}
            className="w-full"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-cyan-300 mb-2">
            Dependencies (comma-separated)
          </label>
          <Input
            type="text"
            placeholder="e.g., capability-1,capability-2"
            value={importRequest.relocationPackage.dependencies.join(', ')}
            onChange={(e) => {
              const dependencies = e.target.value
                .split(',')
                .map((dep: string) => dep.trim())
                .filter((dep: string) => dep.length > 0);
              
              setImportRequest(prev => ({
                ...prev,
                relocationPackage: {
                  ...prev.relocationPackage,
                  dependencies
                }
              ));
            }}
            className="w-full"
          />
        </div>
        
        <div className="flex items-center space-x-3">
          <Button
            type="submit"
            disabled={loading}
            className={`w-full px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded hover:bg-cyan-500/30 transition-colors ${
              loading ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {loading ? 'Importing...' : 'Import Companion'}
          </Button>
        </div>
      </form>
      
      {error && (
        <div className="bg-red-500/20 border border-red-500/10 rounded p-4">
          <h4 className="font-semibold text-red-400 mb-2">Import Error</h4>
          <p className="text-red-300">{error}</p>
        </div>
      )}
      
      {importResult && (
        <div className="bg-green-500/20 border border-green-500/10 rounded p-4">
          <h4 className="font-semibold text-green-400 mb-2">Import Result</h4>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <span className="w-3 h-3 rounded" 
                style={{ 
                  backgroundColor: 
                    importResult.status === 'FULLY_RECONSTRUCTED' ? '#10b981' :
                    importResult.status === 'PARTIALLY_RECONSTRUCTED' ? '#f59e0b' :
                    importResult.status === 'RECONSTRUCTED_WITH_SUBSTITUTIONS' ? '#3b82f6' :
                    importResult.status === 'RECONSTRUCTED_WITH_UNRESOLVED_DEPENDENCIES' ? '#ef4444' :
                    '#6b7280'
                }}
              ></span>
              <span className="font-medium text-cyan-300">Status:</span>
              <span className="ml-2 text-cyan-400">{importResult.status}</span>
            </div>
            
            <div className="flex items-center space-x-2">
              <span className="text-cyan-300">Companion ID:</span>
              <span className="ml-2 text-cyan-400 font-mono>{importResult.companionId}</span>
            </div>
            
            <div className="flex items-center space-x-2">
              <span className="text-cyan-300">Import ID:</span>
              <span className="ml-2 text-cyan-400 font-mono>{importResult.importId}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompanionImport;