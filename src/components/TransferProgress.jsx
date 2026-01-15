import React from 'react';
import { motion } from 'framer-motion';
import './TransferProgress.css';

const TransferProgress = ({ progress, speed, fileName, totalSize, transferredSize }) => {
    return (
        <div className="transfer-card">
            <div className="header">
                <h3 className="file-name" title={fileName}>{fileName}</h3>
                <span className="percent">{Math.round(progress)}%</span>
            </div>

            <div className="progress-track">
                <motion.div
                    className="progress-bar"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.2 }}
                />
            </div>

            <div className="stats">
                <span>{transferredSize} / {totalSize}</span>
                <span>{speed}</span>
            </div>
        </div>
    );
};

export default TransferProgress;
