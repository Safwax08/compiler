import React, { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import './DropZone.css';

const DropZone = ({ onFilesSelected }) => {
    const [isHere, setIsHere] = useState(false);
    const inputRef = useRef(null);
    const folderInputRef = useRef(null);

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsHere(true);
    };

    const handleDragLeave = () => {
        setIsHere(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsHere(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onFilesSelected(e.dataTransfer.files);
        }
    };

    const handleClick = () => {
        inputRef.current.click();
    };

    const handleFolderClick = (e) => {
        e.stopPropagation();
        folderInputRef.current.click();
    };

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            onFilesSelected(e.target.files);
        }
    };

    return (
        <div
            className={`drop-zone ${isHere ? 'active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleClick}
        >
            <input
                type="file"
                multiple
                ref={inputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
            />
            <input
                type="file"
                webkitdirectory=""
                directory=""
                multiple
                ref={folderInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
            />

            <div className="icon-container">
                <UploadCloud size={64} color={isHere ? "#fff" : "#aaa"} />
            </div>
            <p>Drag & Drop files here</p>
            <p className="sub-text">or click to browse files</p>
            <button className="secondary-btn" onClick={handleFolderClick}>Select Folder</button>
        </div>
    );
};

export default DropZone;
