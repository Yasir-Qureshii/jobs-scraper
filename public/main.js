// Global variables
let currentEventSource = null;
let workflowId = null;

// DOM elements
const loginForm = document.getElementById("loginForm");
const loginSection = document.getElementById("loginSection");
const scraperSection = document.getElementById("scraperSection");
const userStatus = document.getElementById("userStatus");
// const logoutBtn = document.getElementById("logoutBtn");
const errorMsg = document.getElementById("errorMsg");
const submitBtn = document.getElementById("submitBtn");
const submitText = document.getElementById("submitText");
const submitSpinner = document.getElementById("submitSpinner");
const progressOverlay = document.getElementById("progressOverlay");
const progressLog = document.getElementById("progressLog");
const progressBar = document.getElementById("progressBar");
const progressPercentage = document.getElementById("progressPercentage");
const progressTitle = document.getElementById("progressTitle");
const closeProgress = document.getElementById("closeProgress");

// Utility functions
function generateWorkflowId() {
    return 'workflow_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function showLoader() {
    submitText.textContent = "Processing...";
    submitSpinner.classList.remove("d-none");
    submitBtn.disabled = true;
}

function hideLoader() {
    submitText.textContent = "Fetch Jobs";
    submitSpinner.classList.add("d-none");
    submitBtn.disabled = false;
}

function showProgressModal() {
    progressOverlay.classList.remove("d-none");
}

function hideProgressModal() {
    progressOverlay.classList.add("d-none");
    closeProgress.style.display = "none";
    // Clear progress log except first entry
    const firstEntry = progressLog.children[0];
    progressLog.innerHTML = '';
    progressLog.appendChild(firstEntry);
    progressBar.style.width = "0%";
    progressPercentage.textContent = "0%";
    progressTitle.textContent = "🔄 Processing Your Request";

    progressLog.firstElementChild.classList.remove("status-completed");
    progressLog.firstElementChild.classList.add("status-running");
    progressLog.firstElementChild.querySelector(".progress-message").textContent = "";
    progressLog.firstElementChild.querySelector(".progress-icon").innerHTML = '<div class="spinner"></div>';
}

function updateProgress(percentage) {
    progressBar.style.width = percentage + "%";
    progressPercentage.textContent = percentage + "%";
}

// ✅ Helper: mark the last running entry as completed
function markLastEntryCompleted(message) {
    const lastEntry = progressLog.lastElementChild;
    if (lastEntry && lastEntry.classList.contains("status-running")) {
        lastEntry.classList.remove("status-running");
        lastEntry.classList.add("status-completed");

        // Swap spinner → checkmark
        const iconDiv = lastEntry.querySelector(".progress-icon");
        const progressDiv = lastEntry.querySelector(".progress-message");

        if (iconDiv) {
            iconDiv.innerHTML = "✅";
        }
        if (progressDiv) {
            progressDiv.innerHTML = message;
        }
    }
}

function addProgressEntry(data) {
    // Close out the previous running step before adding a new one
    markLastEntryCompleted(data.message);
    const entry = document.createElement('div');
    entry.className = `progress-entry status-${data.status}`;

    let icon = '🔄';
    if (data.status === 'completed') icon = '✅';
    else if (data.status === 'error') icon = '❌';
    else if (data.status === 'running') icon = '⚙️';

    entry.innerHTML = `
                <div class="progress-icon">${data.status === 'running' ? '<div class="spinner"></div>' : icon}</div>
                <div class="progress-content">
                    <div class="progress-step">${data.step || 'Step'}</div>
                    <div class="progress-message">${data.newMessage}</div>
                </div>
            `;

    if(data.status !== 'completed'){
        progressLog.appendChild(entry);
    }

    progressLog.scrollTop = progressLog.scrollHeight;

    // Update progress bar if percentage is provided
    if (data.progress !== undefined) {
        updateProgress(data.progress);
    }
}

const BASE_URL = 'https://jobs-scraper-v2jf.onrender.com'; 

function setupProgressMonitoring(wfId) {
    console.log('Setting up progress monitoring for workflow:', wfId);

    // Test connection
    fetch(`${BASE_URL}/health`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Health check failed: ${response.status}`);
            }
            console.log('✅ Backend health check passed');
            connectToSSE(wfId);
        })
        .catch(error => {
            console.error('❌ Backend health check failed:', error);
            addProgressEntry({
                step: "Connection Error",
                message: "Cannot connect to backend server. Please try again later.",
                status: "error"
            });
            hideLoader();
        });
}

function connectToSSE(wfId) {
    // Add bypass headers for free tier
    const sseUrl = `${BASE_URL}/progress/${wfId}`;
    console.log('Connecting to SSE:', sseUrl);

    currentEventSource = new EventSource(sseUrl);

    let connectionTimeout = setTimeout(() => {
        console.error('SSE connection timeout');
        if (currentEventSource) {
            currentEventSource.close();
            handleConnectionError('Connection timeout - please try again later');
        }
    }, 6000000); // 1 hour timeout

    currentEventSource.onmessage = function (event) {
        // console.log('📨 Progress update received:', event.data);
        try {
            const data = JSON.parse(event.data);
            handleProgressUpdate(data);
        } catch (err) {
            console.error('Error parsing progress data:', err);
        }
    };

    currentEventSource.onerror = function (event) {
        console.error('❌ SSE connection error:', event);
        clearTimeout(connectionTimeout);

        // if (currentEventSource.readyState === EventSource.CLOSED) {
        //     handleConnectionError('Connection closed by server');
        // } else if (currentEventSource.readyState === EventSource.CONNECTING) {
        //     handleConnectionError('Failed to connect - check ngrok URL and server');
        // } else {
        //     handleConnectionError('Unknown connection error');
        // }
    };
}

function handleConnectionError(errorMessage) {
    addProgressEntry({
        step: "Connection Error",
        newMessage: `${errorMessage}`,
        status: "error"
    });

}

function handleProgressUpdate(data) {
    console.log('Handling progress update:', data);

    switch (data.type) {
        case 'connection':
            console.log('Connection confirmed');
            break;

        case 'progress':
            addProgressEntry(data);
            break;

        case 'complete':
            addProgressEntry({
                ...data,
                step: "Complete",
                status: "completed"
            });
            progressTitle.innerHTML = "🎉 Request Completed Successfully!";
            closeProgress.style.display = "block";
            currentEventSource.close();
            currentEventSource = null;
            
            setTimeout(() => {
                hideLoader();
                setTimeout(() => hideProgressModal(), 60000);
            }, 1500);
            break;

        case 'error':
            // addProgressEntry({
            //     ...data,
            //     step: "Error",
            //     message: `${data.message}`,
            //     status: "error"
            // });
            handleWorkflowError(data)
            // progressTitle.innerHTML = "Job Search Failed";
            // closeProgress.style.display = "block";
            // hideLoader();
            currentEventSource.close();
            currentEventSource = null;
            break;

        default:
            // Handle any other progress updates from n8n
            addProgressEntry(data);
            break;
    }
}

function handleWorkflowError(data) {
    // addProgressEntry({
    //     step: "Error",
    //     message: error,
    //     status: "error"
    // });
    
    progressLog.lastElementChild.querySelector(".progress-message").textContent = data.message;
    progressLog.lastElementChild.querySelector(".progress-icon").innerHTML = '❌';
    
    progressTitle.innerHTML = "Job Search Failed";
    closeProgress.style.display = "block";
    hideLoader();
}

// Login functionality
// function showScraper(email) {
//     loginSection.classList.add("d-none");
//     scraperSection.classList.remove("d-none");
//     userStatus.innerText = `${email} — Logged in`;
//     logoutBtn.classList.remove("d-none");
// }

function showScraper() {
    loginSection.classList.add("d-none");
    scraperSection.classList.remove("d-none");
    userStatus.innerText = `Demo User — Logged in`;
    // logoutBtn.classList.remove("d-none");
}

function showLogin() {
    loginSection.classList.remove("d-none");
    scraperSection.classList.add("d-none");
    userStatus.innerText = "Not logged in";
    // logoutBtn.classList.add("d-none");
}

// Event listeners
document.addEventListener("DOMContentLoaded", () => {
    // const savedUser = localStorage.getItem("loggedInUser");
    // if (savedUser) showScraper(savedUser);
    // else showLogin();
    showScraper()
});

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    try {
        const res = await fetch("/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
            localStorage.setItem("loggedInUser", data.email);
            showScraper(data.email);
        } else {
            errorMsg.innerText = data.message || "Login failed";
        }
    } catch (err) {
        console.error(err);
        errorMsg.innerText = "Server error, please try again.";
    }
});

// logoutBtn.addEventListener("click", () => {
//     localStorage.removeItem("loggedInUser");
//     showLogin();
// });

// Cover letter toggle
// const coverCheckbox = document.getElementById("coverLetterCheckbox");
const coverInput = document.getElementById("coverLetterDriveInput");
const coverContainer = document.getElementById("coverLetterDriveContainer");
const coverError = document.getElementById("coverLetterDriveError");

// coverCheckbox.addEventListener("change", () => {
//     if (coverCheckbox.checked) {
//         coverContainer.style.display = "block";
//         coverInput.setAttribute("required", "true");
//     } else {
//         coverContainer.style.display = "none";
//         coverInput.removeAttribute("required");
//         coverInput.value = "";
//         coverError.style.display = "none";
//     }
// });

// Close progress modal
closeProgress.addEventListener("click", () => {
    if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
    }
    hideProgressModal();
});

// Main form submission
const scraperFormElement = document.getElementById("scraperForm");
const targetSheetInput = document.getElementById("targetSheetLink");
const targetSheetError = document.getElementById("targetSheetError");

scraperFormElement.addEventListener("submit", async (e) => {
    e.preventDefault();
    let hasError = false;

    // Validation
    // if (coverCheckbox.checked) {
    //     const link = coverInput.value.trim();
    //     if (!link.startsWith("https://drive.google.com/drive/folders/")) {
    //         coverError.style.display = "block";
    //         hasError = true;
    //     } else coverError.style.display = "none";
    // }

    const targetLink = targetSheetInput.value.trim();
    if (!targetLink.startsWith("https://docs.google.com/spreadsheets/d/")) {
        targetSheetError.classList.remove("d-none");
        hasError = true;
    } else targetSheetError.classList.add("d-none");

    if (hasError) return;

    // Generate workflow ID and prepare payload
    workflowId = generateWorkflowId();
    const payload = {
        workflowId: workflowId,
        title: document.getElementById("title").value.trim(),
        location: document.getElementById("location").value.trim(),
        contractType: [document.getElementById("contractType").value].filter(Boolean),
        experienceLevel: [document.getElementById("experienceLevel").value].filter(Boolean),
        workType: [document.getElementById("workType").value].filter(Boolean),
        publishedAt: document.getElementById("publishedAt").value || "",
        targetScore: parseInt(document.getElementById("targetScore").value) || 85,
        // coverLetter: coverCheckbox.checked,
        coverLetterDrive: coverInput.value.trim(),
        resumeSummary: document.getElementById("resumeSummary").value.trim(),
        preferences: document.getElementById("preferences").value.trim(),
        targetSheetLink: targetSheetInput.value.trim()
    };

    // Show loader and progress modal
    // showLoader();
    showProgressModal();

    // Set up progress monitoring (in real implementation, this would connect to your SSE endpoint)
    setupProgressMonitoring(workflowId);

    try {
        const response = await fetch(
            "https://abbt989.app.n8n.cloud/webhook/37768662-1ef6-4aba-942b-d8ecc75ffbd5",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            }
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // The actual progress updates will come through SSE
        const data = await response.json();
        // console.log("Webhook response:", data);
        const executionId = data.executionId;

        // 🔗 Register the mapping with your backend
        await fetch("/api/register-execution", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ executionId, workflowId })
        });


    } catch (err) {
        console.error('❌ Failed to trigger workflow:', err);
        handleWorkflowError("Request Could not be processed. Please try again Later.");
    }

});