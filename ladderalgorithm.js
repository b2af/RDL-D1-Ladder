import { 
    collection,
    doc, 
    getDoc, 
    getDocs,
    updateDoc, 
    setDoc, 
    deleteDoc,
    writeBatch,
    query,
    where,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db, auth } from './firebase-config.js';
import { recordEloChange } from './elo-history.js';
import { PromotionHandler } from './promotion-handler.js';
import { isAdmin } from './admin-check.js';

// ladderalgorithm.js
export function calculateElo(winnerRating, loserRating, kFactor = 32) {
    const expectedScoreWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    const expectedScoreLoser = 1 / (1 + Math.pow(10, (winnerRating - loserRating) / 400));

    const newWinnerRating = winnerRating + kFactor * (1 - expectedScoreWinner);
    const newLoserRating = loserRating + kFactor * (0 - expectedScoreLoser);

    return {
        newWinnerRating: Math.round(newWinnerRating),
        newLoserRating: Math.round(newLoserRating)
    };
}

export function assignDefaultEloRating(playerId, playerData) {
    const defaultEloRating = 1200; // Default ELO rating
    if (!playerData.eloRating) {
        db.collection('players').doc(playerId).update({ eloRating: defaultEloRating })
            .then(() => {
                console.log(`Assigned default ELO rating to player ${playerData.username}`);
            })
            .catch(error => {
                console.error('Error assigning default ELO rating:', error);
            });
    }
}

export async function updateEloRatings(winnerId, loserId, matchId) {
    try {
        console.log('Starting ELO update for winner:', winnerId, 'and loser:', loserId);
        
        // Get the current ratings and positions of both players
        const winnerRef = doc(db, 'players', winnerId);
        const loserRef = doc(db, 'players', loserId);
        
        const [winnerDoc, loserDoc] = await Promise.all([
            getDoc(winnerRef),
            getDoc(loserRef)
        ]);

        if (!winnerDoc.exists() || !loserDoc.exists()) {
            throw new Error('One or both players not found in the database.');
        }

        const winnerData = winnerDoc.data();
        const loserData = loserDoc.data();
        
        // Store original positions
        const winnerPosition = winnerData.position || Number.MAX_SAFE_INTEGER;
        const loserPosition = loserData.position || Number.MAX_SAFE_INTEGER;
        
        // Calculate new ELO ratings
        const { newWinnerRating, newLoserRating } = calculateElo(
            winnerData.eloRating || 1200,
            loserData.eloRating || 1200
        );

        // Create batch for atomic updates
        const batch = writeBatch(db);

        // If winner was lower ranked (higher position number), swap positions
        if (winnerPosition > loserPosition) {
            // Winner takes loser's spot, loser moves down one
            const winnerUpdates = {
                eloRating: newWinnerRating,
                lastMatchDate: serverTimestamp(),
                position: loserPosition,
                matchId: matchId,
                participantIds: [winnerId, loserId]
            };

            const loserUpdates = {
                eloRating: newLoserRating,
                lastMatchDate: serverTimestamp(),
                position: loserPosition + 1,
                matchId: matchId,
                participantIds: [winnerId, loserId]
            };

            // Move everyone else down one position if needed
            const playersToUpdate = query(
                collection(db, 'players'),
                where('position', '>', loserPosition),
                where('position', '<=', winnerPosition)
            );
            
            const playersSnapshot = await getDocs(playersToUpdate);
            playersSnapshot.forEach(playerDoc => {
                if (playerDoc.id !== winnerId && playerDoc.id !== loserId) {
                    batch.update(doc(db, 'players', playerDoc.id), {
                        position: playerDoc.data().position + 1
                    });
                }
            });

            batch.update(winnerRef, winnerUpdates);
            batch.update(loserRef, loserUpdates);
        }

        // Record ELO history
        await Promise.all([
            recordEloChange(
                winnerId,
                winnerData.eloRating || 1200,
                newWinnerRating,
                loserId,
                'win'
            ),
            recordEloChange(
                loserId,
                loserData.eloRating || 1200,
                newLoserRating,
                winnerId,
                'loss'
            )
        ]);

        // Commit all updates atomically
        await batch.commit();

        console.log('ELO ratings and positions updated successfully');
        return true;

    } catch (error) {
        console.error('Error in updateEloRatings:', error);
        throw error;
    }
}

export async function approveReport(reportId, winnerScore, winnerSuicides, winnerComment) {
    try {
        console.log('Starting approveReport function with:', { reportId, winnerScore, winnerSuicides, winnerComment });
        
        const currentUser = auth.currentUser;
        if (!currentUser) {
            console.log('No user logged in');
            throw new Error('You must be logged in to approve matches');
        }
        console.log('Current user:', currentUser.email);

        // Get user's player document to verify permissions
        const userDoc = await getDoc(doc(db, 'players', currentUser.uid));
        const currentUsername = userDoc.exists() ? userDoc.data().username : null;
        console.log('Current username:', currentUsername);

        // Get the pending match
        const pendingMatchRef = doc(db, 'pendingMatches', reportId);
        const reportSnapshot = await getDoc(pendingMatchRef);

        if (!reportSnapshot.exists()) {
            console.log('Report not found with ID:', reportId);
            throw new Error('Match report not found');
        }

        const reportData = reportSnapshot.data();
        console.log('Report data:', reportData);
        
        // Check if user is participant or admin
        const isParticipant = currentUsername === reportData.winnerUsername || 
                             currentUsername === reportData.loserUsername;
        const userIsAdmin = await isAdmin(currentUser.email);

        if (!isParticipant && !userIsAdmin) {
            throw new Error('Only match participants or admins can approve matches');
        }

        // Add winner details to report data
        const updatedReportData = {
            ...reportData,
            winnerScore: winnerScore,
            winnerSuicides: winnerSuicides,
            winnerComment: winnerComment,
            approved: true,
            approvedAt: serverTimestamp(),
            approvedBy: currentUsername
        };

        // Move match to approved collection first
        await setDoc(doc(db, 'approvedMatches', reportId), updatedReportData);
        await deleteDoc(pendingMatchRef);

        console.log('Match moved to approved collection');

        // Get player IDs
        const [winnerDocs, loserDocs] = await Promise.all([
            getDocs(query(collection(db, 'players'), where('username', '==', reportData.winnerUsername))),
            getDocs(query(collection(db, 'players'), where('username', '==', reportData.loserUsername)))
        ]);

        if (winnerDocs.empty || loserDocs.empty) {
            throw new Error('Could not find player documents');
        }

        const winnerId = winnerDocs.docs[0].id;
        const loserId = loserDocs.docs[0].id;

        // Update ELO ratings
        await updateEloRatings(winnerId, loserId, reportId);

        console.log('Match successfully approved and ELO updated');
        return true;

    } catch (error) {
        console.error('Error in approveReport:', error);
        throw error;
    }
}

async function updatePlayerElo(userId, oldElo, newElo) {
    // Update player's ELO in database
    await setDoc(doc(db, 'players', userId), {
        ...playerData,
        eloRating: newElo
    });

    // Check for promotion
    await PromotionHandler.checkPromotion(userId, newElo, oldElo);
}